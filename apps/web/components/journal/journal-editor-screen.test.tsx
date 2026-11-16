import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalDoc, JournalEntry } from '@command-center/contracts';
import { ApiError } from '@/lib/api';
import { createMemoryDraftStore, type DraftStore } from '@/lib/journal-drafts';
import JournalEditorScreen, { type JournalEditorScreenProps } from './journal-editor-screen';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: (): { push: typeof push } => ({ push }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/journal-api', () => ({
  createJournalEntry: vi.fn(),
  patchJournalEntry: vi.fn(),
  fetchJournalEntry: vi.fn(),
  fetchJournalToday: vi.fn(),
  deleteJournalEntry: vi.fn(),
}));
let store: DraftStore;
vi.mock('@/lib/journal-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/journal-drafts')>()),
  getDraftStore: async (): Promise<DraftStore> => store,
}));

import {
  createJournalEntry,
  deleteJournalEntry,
  fetchJournalEntry,
  fetchJournalToday,
  patchJournalEntry,
} from '@/lib/journal-api';

const ID = '6740a1b2c3d4e5f601234567';
const PROMPT = { id: 'surprise', text: 'What surprised you today?' };
const doc = (text: string): JournalDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const entry = (text: string, version: number): JournalEntry => ({
  id: ID,
  entryDate: '2026-11-16',
  textPreview: text,
  wordCount: 1,
  tags: [],
  promptId: null,
  version,
  createdAt: '2026-11-16T08:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
  doc: doc(text),
  schemaVersion: 1,
});

function renderScreen(props: JournalEditorScreenProps): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JournalEditorScreen {...props} />
    </QueryClientProvider>,
  );
  return client;
}

/** TipTap keeps its instance on the ProseMirror DOM node. */
/**
 * The mounted editor, once its `autofocus` has settled. TipTap focuses in a
 * setTimeout and again in a requestAnimationFrame after mount; a test that
 * moves focus before that frame lands has it stolen back (a real modal
 * dialog makes the editor inert, jsdom does not).
 */
async function editorInstance(): Promise<Editor> {
  const textbox = await screen.findByRole('textbox', { name: 'Journal entry' });
  await waitFor(() => expect(textbox).toHaveFocus());
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  return (textbox as HTMLElement & { editor: Editor }).editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createMemoryDraftStore();
  vi.mocked(fetchJournalToday).mockResolvedValue({
    date: '2026-11-16',
    prompt: PROMPT,
    entry: null,
    entriesToday: 0,
  });
  vi.mocked(createJournalEntry).mockImplementation(async (request) => ({
    ...entry('', 1),
    doc: request.doc as JournalDoc,
  }));
  vi.mocked(patchJournalEntry).mockImplementation(async (_id, request) => ({
    ...entry('', request.baseVersion + 1),
    doc: request.doc as JournalDoc,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JournalEditorScreen — new entry', () => {
  it('shows the prompt as the editor’s description and creates on the first autosave', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderScreen({ promptId: 'surprise', from: 'dashboard' });

    const editor = await editorInstance();
    expect(screen.getByRole('heading', { level: 2, name: /16 November 2026/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Journal entry' })).toHaveAccessibleDescription(
      `Today’s prompt: ${PROMPT.text}`,
    );
    expect(screen.getByText('Saves as you write')).toBeInTheDocument();

    act(() => {
      editor.commands.insertContent('The heron was back.');
    });
    expect((await store.get('new:2026-11-16'))?.doc).toEqual(doc('The heron was back.'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(createJournalEntry).toHaveBeenCalledWith({
      entryDate: '2026-11-16',
      doc: doc('The heron was back.'),
      tags: [],
      promptId: 'surprise',
    });
    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(null, '', `/journal/${ID}?from=dashboard`),
    );
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('reopens an unsaved local draft instead of a blank page', async () => {
    await store.put({
      key: 'new:2026-11-16',
      entryId: null,
      entryDate: '2026-11-16',
      promptId: null,
      doc: doc('Written while offline'),
      tags: ['rest'],
      baseVersion: null,
      updatedAt: '2026-11-16T07:00:00.000Z',
    });
    renderScreen({});
    const editor = await editorInstance();
    expect(editor.getText()).toBe('Written while offline');
    expect(screen.getByLabelText('Tags')).toHaveValue('rest');
  });

  it('opens for writing even when the API is down', async () => {
    vi.mocked(fetchJournalToday).mockRejectedValue(new Error('down'));
    renderScreen({ date: '2026-11-14' });
    await editorInstance();
    expect(screen.getByRole('heading', { level: 2, name: /14 November 2026/ })).toBeVisible();
  });
});

describe('JournalEditorScreen — saved entry', () => {
  it('surfaces a draft from an older version as a conflict, and keeps mine on request', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchJournalEntry).mockResolvedValue(entry('Saved on the phone', 4));
    await store.put({
      key: `entry:${ID}`,
      entryId: ID,
      entryDate: '2026-11-16',
      promptId: null,
      doc: doc('Typed on the laptop'),
      tags: [],
      baseVersion: 3,
      updatedAt: '2026-11-16T08:30:00.000Z',
    });
    renderScreen({ entryId: ID });

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/);
    expect((await editorInstance()).getText()).toBe('Typed on the laptop');
    expect(patchJournalEntry).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep my version' }));
    expect(patchJournalEntry).toHaveBeenCalledWith(ID, {
      baseVersion: 4,
      doc: doc('Typed on the laptop'),
      tags: [],
    });
  });

  it('can take the saved version instead', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchJournalEntry).mockResolvedValue(entry('Saved on the phone', 4));
    await store.put({
      key: `entry:${ID}`,
      entryId: ID,
      entryDate: '2026-11-16',
      promptId: null,
      doc: doc('Typed on the laptop'),
      tags: [],
      baseVersion: 3,
      updatedAt: '2026-11-16T08:30:00.000Z',
    });
    renderScreen({ entryId: ID });
    const editor = await editorInstance();
    await user.click(await screen.findByRole('button', { name: 'Use the saved version' }));
    await waitFor(() => expect(editor.getText()).toBe('Saved on the phone'));
    expect(await store.get(`entry:${ID}`)).toBeNull();
    expect(patchJournalEntry).not.toHaveBeenCalled();
  });

  it('opens the local draft when the API is down, and refetches never unmount the editor', async () => {
    vi.mocked(fetchJournalEntry).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(fetchJournalToday).mockRejectedValue(new TypeError('Failed to fetch'));
    await store.put({
      key: `entry:${ID}`,
      entryId: ID,
      entryDate: '2026-11-16',
      promptId: null,
      doc: doc('Offline words'),
      tags: [],
      baseVersion: 2,
      updatedAt: '2026-11-16T08:30:00.000Z',
    });
    const client = renderScreen({ entryId: ID });
    // The entry query retries once (1 s) before giving up on the network.
    const textbox = await screen.findByRole(
      'textbox',
      { name: 'Journal entry' },
      { timeout: 3000 },
    );
    expect((await editorInstance()).getText()).toBe('Offline words');

    // An errored query flips back to pending when it refetches; the editor stays.
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(screen.getByRole('textbox', { name: 'Journal entry' })).toBe(textbox);
    // Two fetches (each with its one retry) — not a remount loop.
    expect(vi.mocked(fetchJournalEntry).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('says so when the entry does not exist', async () => {
    vi.mocked(fetchJournalEntry).mockRejectedValue(new ApiError('/x', 404));
    renderScreen({ entryId: ID });
    expect(await screen.findByText(/doesn’t exist/)).toBeInTheDocument();
  });

  it('deletes behind a confirmation and goes back', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchJournalEntry).mockResolvedValue(entry('Short-lived', 2));
    vi.mocked(deleteJournalEntry).mockResolvedValue();
    renderScreen({ entryId: ID });
    await editorInstance();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete entry' }));

    expect(deleteJournalEntry).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/journal'));
  });
});

describe('formatting toolbar', () => {
  it('is one tab stop with arrow-key movement, pressed states and Esc back to the text', async () => {
    vi.mocked(fetchJournalEntry).mockResolvedValue(entry('Some words', 2));
    renderScreen({ entryId: ID });
    const editor = await editorInstance();

    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(bold).toHaveAttribute('tabindex', '0');
    expect(italic).toHaveAttribute('tabindex', '-1');
    expect(bold).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');

    act(() => bold.focus());
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(italic).toHaveFocus();
    expect(italic).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(toolbar, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Divider' })).toHaveFocus();

    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');

    fireEvent.keyDown(toolbar, { key: 'Escape' });
    await waitFor(() => expect(editor.isFocused).toBe(true));
  });

  it('opens the link form, refuses non-web links and applies http(s) ones', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchJournalEntry).mockResolvedValue(entry('a link', 2));
    renderScreen({ entryId: ID });
    const editor = await editorInstance();
    // Opening focuses the text (autofocus runs a tick later); let it land first.
    await waitFor(() => expect(editor.isFocused).toBe(true));
    act(() => {
      editor.commands.selectAll();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const field = screen.getByLabelText('Link address');
    expect(field).toHaveFocus();
    await user.type(field, 'javascript:alert(1){Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/http:\/\/ or https:\/\//);

    await user.clear(field);
    await user.type(field, 'example.com{Enter}');
    expect(screen.queryByLabelText('Link address')).toBeNull();
    expect(JSON.stringify(editor.getJSON())).toContain('"href":"https://example.com"');
  });
});
