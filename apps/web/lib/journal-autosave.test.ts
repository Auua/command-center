import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalDoc, JournalEntry } from '@command-center/contracts';
import { ApiError } from '@/lib/api';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  JournalAutosave,
  reconcileDraft,
  type AutosaveApi,
} from './journal-autosave';
import { createMemoryDraftStore, type DraftStore, type JournalDraft } from './journal-drafts';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

const doc = (text: string): JournalDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const ID = '6740a1b2c3d4e5f601234567';

function entry(text: string, version: number, extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: ID,
    entryDate: '2026-11-16',
    textPreview: text,
    wordCount: 1,
    tags: [],
    promptId: null,
    version,
    createdAt: '2026-11-16T08:00:00.000Z',
    updatedAt: `2026-11-16T08:00:0${version}.000Z`,
    doc: doc(text),
    schemaVersion: 1,
    ...extra,
  };
}

function fakeApi(): AutosaveApi & Record<'create' | 'patch' | 'get', ReturnType<typeof vi.fn>> {
  let version = 1;
  return {
    create: vi.fn(async (request) => entry(textOf(request.doc as JournalDoc), 1)),
    patch: vi.fn(async (_id, request) => {
      version = request.baseVersion + 1;
      return entry(textOf(request.doc as JournalDoc), version);
    }),
    get: vi.fn(async () => entry('server copy', 7)),
  };
}

function textOf(value: JournalDoc): string {
  const first = value.content?.[0];
  return first?.type === 'paragraph' && first.content?.[0]?.type === 'text'
    ? first.content[0].text
    : '';
}

/** Let pending promise callbacks (the save, the draft writes) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

let drafts: DraftStore;
beforeEach(() => {
  vi.useFakeTimers();
  drafts = createMemoryDraftStore();
});
afterEach(() => {
  vi.useRealTimers();
});

function newEngine(
  api: AutosaveApi,
  overrides: Partial<ConstructorParameters<typeof JournalAutosave>[0]> = {},
): JournalAutosave {
  return new JournalAutosave({
    api,
    drafts,
    entryDate: '2026-11-16',
    promptId: 'surprise',
    entryId: null,
    version: null,
    doc: doc(''),
    tags: [],
    ...overrides,
  });
}

describe('JournalAutosave', () => {
  it('writes the draft on every edit, before any request', async () => {
    const api = fakeApi();
    const engine = newEngine(api);
    engine.edit({ doc: doc('H') });
    await settle();
    expect((await drafts.get('new:2026-11-16'))?.doc).toEqual(doc('H'));
    expect(api.create).not.toHaveBeenCalled();
    expect(engine.getSnapshot()).toMatchObject({ status: 'pending', unsynced: true });
  });

  it('creates 2 s after the last edit, re-keys to the entry and clears the draft', async () => {
    const api = fakeApi();
    const onCreated = vi.fn();
    const engine = newEngine(api, { onCreated });
    engine.edit({ doc: doc('Hel') });
    await vi.advanceTimersByTimeAsync(1500);
    engine.edit({ doc: doc('Hello') });
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({
      entryDate: '2026-11-16',
      doc: doc('Hello'),
      tags: [],
      promptId: 'surprise',
    });
    await settle();
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
    expect(engine.getSnapshot()).toMatchObject({
      status: 'saved',
      entryId: ID,
      version: 1,
      unsynced: false,
    });
    expect(await drafts.get('new:2026-11-16')).toBeNull();
    expect(await drafts.get(`entry:${ID}`)).toBeNull();
  });

  it('saves at least every 10 s while typing never pauses', async () => {
    const api = fakeApi();
    const engine = newEngine(api, { entryId: ID, version: 1 });
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 1000) {
      engine.edit({ doc: doc(`t${elapsed}`) });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith(ID, expect.objectContaining({ baseVersion: 1 }));
  });

  it('flushes immediately and sends edits made mid-save in the next request', async () => {
    const api = fakeApi();
    let release: () => void = () => {};
    api.patch.mockImplementationOnce(
      (_id, request) =>
        new Promise((resolve) => {
          release = (): void => resolve(entry(textOf(request.doc as JournalDoc), 2));
        }),
    );
    const engine = newEngine(api, { entryId: ID, version: 1 });
    engine.edit({ doc: doc('one') });
    void engine.flush();
    expect(api.patch).toHaveBeenCalledTimes(1);
    engine.edit({ doc: doc('one two') });
    void engine.flush(); // in flight: queued, not sent in parallel
    expect(api.patch).toHaveBeenCalledTimes(1);
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch).toHaveBeenLastCalledWith(
      ID,
      expect.objectContaining({ baseVersion: 2, doc: doc('one two') }),
    );
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: 'saved', version: 3 });
  });

  it('keeps writing locally while offline and retries with backoff', async () => {
    const api = fakeApi();
    api.patch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError('/x', 503));
    const engine = newEngine(api, { entryId: ID, version: 1 });
    engine.edit({ doc: doc('offline words') });
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({ status: 'offline', unsynced: true });
    expect((await drafts.get(`entry:${ID}`))?.doc).toEqual(doc('offline words'));

    engine.edit({ doc: doc('more offline words') });
    await vi.advanceTimersByTimeAsync(2000); // first retry (2 s) → 503
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot().status).toBe('offline');
    await vi.advanceTimersByTimeAsync(3999);
    expect(api.patch).toHaveBeenCalledTimes(2); // backoff doubled to 4 s
    await vi.advanceTimersByTimeAsync(1);
    expect(api.patch).toHaveBeenCalledTimes(3);
    expect(api.patch).toHaveBeenLastCalledWith(
      ID,
      expect.objectContaining({ doc: doc('more offline words') }),
    );
    await settle();
    expect(engine.getSnapshot().status).toBe('saved');
    expect(await drafts.get(`entry:${ID}`)).toBeNull();
  });

  it('stops on a 409, keeps the draft, and lets the user keep their copy', async () => {
    const api = fakeApi();
    api.patch.mockRejectedValueOnce(new ApiError('/x', 409));
    const engine = newEngine(api, { entryId: ID, version: 1 });
    engine.edit({ doc: doc('mine') });
    await engine.flush();
    await settle();
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe('conflict');
    expect(snapshot.conflict?.server?.version).toBe(7);
    expect((await drafts.get(`entry:${ID}`))?.doc).toEqual(doc('mine'));

    // Further edits never save over the other copy on their own.
    engine.edit({ doc: doc('mine, still') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(api.patch).toHaveBeenCalledTimes(1);

    await engine.resolveConflict('keep');
    await settle();
    expect(api.patch).toHaveBeenLastCalledWith(
      ID,
      expect.objectContaining({ baseVersion: 7, doc: doc('mine, still') }),
    );
    expect(engine.getSnapshot()).toMatchObject({ status: 'saved', conflict: null });
  });

  it('can discard the local copy for the saved one', async () => {
    const api = fakeApi();
    api.patch.mockRejectedValueOnce(new ApiError('/x', 409));
    const engine = newEngine(api, { entryId: ID, version: 1 });
    engine.edit({ doc: doc('mine') });
    await engine.flush();
    await settle();
    const server = await engine.resolveConflict('discard');
    expect(server?.doc).toEqual(doc('server copy'));
    expect(engine.getSnapshot()).toMatchObject({ status: 'saved', version: 7, unsynced: false });
    expect(await drafts.get(`entry:${ID}`)).toBeNull();
  });

  it('does not retry a refused save until the next edit', async () => {
    const api = fakeApi();
    api.patch.mockRejectedValueOnce(new ApiError('/x', 400));
    const engine = newEngine(api, { entryId: ID, version: 1 });
    engine.edit({ doc: doc('too much') });
    await engine.flush();
    expect(engine.getSnapshot().status).toBe('rejected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.patch).toHaveBeenCalledTimes(1);
    engine.edit({ doc: doc('less') });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it('saves a restored draft soon after opening, and once more on dispose', async () => {
    const api = fakeApi();
    const engine = newEngine(api, {
      entryId: ID,
      version: 1,
      doc: doc('restored'),
      restored: true,
    });
    expect(engine.getSnapshot()).toMatchObject({ status: 'pending', unsynced: true });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(api.patch).toHaveBeenCalledWith(ID, expect.objectContaining({ doc: doc('restored') }));
    await settle();

    engine.edit({ doc: doc('last words') });
    engine.dispose();
    expect(api.patch).toHaveBeenCalledTimes(2);
  });
});

describe('reconcileDraft', () => {
  const draft = (baseVersion: number | null): JournalDraft => ({
    key: `entry:${ID}`,
    entryId: ID,
    entryDate: '2026-11-16',
    promptId: null,
    doc: doc('local'),
    tags: ['x'],
    baseVersion,
    updatedAt: '2026-11-16T09:00:00.000Z',
  });

  it('opens the server copy when there is no draft', () => {
    expect(reconcileDraft(entry('server', 3), null)).toBeNull();
  });

  it('restores a draft edited from the current version', () => {
    expect(reconcileDraft(entry('server', 3), draft(3))).toMatchObject({
      restored: true,
      doc: doc('local'),
    });
  });

  it('flags a draft edited from an older version as a conflict', () => {
    expect(reconcileDraft(entry('server', 4), draft(3))?.conflict).toEqual({
      server: expect.objectContaining({ version: 4 }),
      localEditedAt: '2026-11-16T09:00:00.000Z',
    });
  });
});
