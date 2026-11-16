import type {
  CreateJournalEntryRequest,
  JournalDoc,
  JournalEntry,
  PatchJournalEntryRequest,
} from '@command-center/contracts';
import { ApiError } from '@/lib/api';
import {
  draftKeyForEntry,
  draftKeyForNew,
  type DraftStore,
  type JournalDraft,
} from './journal-drafts';

/**
 * The journal's save engine (ADR-016 autosave policy), free of React so the
 * timing rules are testable with fake timers:
 *
 * - every edit is written to the local draft store immediately;
 * - the server save runs 2 s after the last edit, and at least every 10 s
 *   while typing continues; `flush()` saves now (blur, hide, leave);
 * - one request at a time — edits made during a save go into the next one;
 * - a 409 stops saving and surfaces a conflict; nothing is overwritten
 *   until the user picks "keep mine" or "use the saved one";
 * - network / 5xx failures keep the draft and retry with backoff (2 s → 60 s);
 * - the draft is deleted only after the server confirmed the content it holds.
 */

export type SaveStatus =
  /** Nothing edited since open. */
  | 'idle'
  /** Edited; a save is scheduled. */
  | 'pending'
  | 'saving'
  | 'saved'
  /** The server could not be reached; kept locally, retrying. */
  | 'offline'
  /** Changed elsewhere since this copy was opened; waiting for the user. */
  | 'conflict'
  /** The server refused the content (e.g. too large); kept locally, not retried until the next edit. */
  | 'rejected';

export interface SaveConflict {
  /** The entry as the server holds it now. Null if it could not be read. */
  server: JournalEntry | null;
  /** When this copy was last edited locally. */
  localEditedAt: string;
}

export interface AutosaveSnapshot {
  status: SaveStatus;
  entryId: string | null;
  version: number | null;
  /** Server `updatedAt` of the last confirmed save. */
  lastSavedAt: string | null;
  conflict: SaveConflict | null;
  /** Local edits the server has not confirmed yet. */
  unsynced: boolean;
}

export interface AutosaveApi {
  create(request: CreateJournalEntryRequest): Promise<JournalEntry>;
  patch(id: string, request: PatchJournalEntryRequest): Promise<JournalEntry>;
  get(id: string): Promise<JournalEntry>;
}

export interface AutosaveOptions {
  api: AutosaveApi;
  drafts: DraftStore;
  entryDate: string;
  promptId: string | null;
  /** Saved entry being edited; null for a new one. */
  entryId: string | null;
  version: number | null;
  lastSavedAt?: string | null;
  doc: JournalDoc;
  tags: string[];
  /** Content came from an unsynced local draft: save it soon. */
  restored?: boolean;
  /** Opened on a draft edited from an older version than the server's. */
  conflict?: SaveConflict | null;
  onCreated?: (entry: JournalEntry) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  now?: () => Date;
}

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const AUTOSAVE_MAX_WAIT_MS = 10_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;

type Timer = ReturnType<typeof setTimeout>;

export class JournalAutosave {
  private snapshot: AutosaveSnapshot;
  private readonly listeners = new Set<() => void>();
  private content: { doc: JournalDoc; tags: string[] };
  private key: string;
  private dirty: boolean;
  private localEditedAt: string;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private debounceTimer: Timer | null = null;
  private maxTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private retryDelay: number;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: AutosaveOptions) {
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
    this.retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? RETRY_MAX_MS;
    this.retryDelay = this.retryBaseMs;
    this.now = options.now ?? ((): Date => new Date());
    this.content = { doc: options.doc, tags: options.tags };
    this.key = options.entryId
      ? draftKeyForEntry(options.entryId)
      : draftKeyForNew(options.entryDate);
    this.dirty = Boolean(options.restored || options.conflict);
    this.localEditedAt = options.conflict?.localEditedAt ?? this.now().toISOString();
    this.snapshot = {
      status: options.conflict ? 'conflict' : options.restored ? 'pending' : 'idle',
      entryId: options.entryId,
      version: options.version,
      lastSavedAt: options.lastSavedAt ?? null,
      conflict: options.conflict ?? null,
      unsynced: this.dirty,
    };
    if (options.restored && !options.conflict) this.schedule();
  }

  getSnapshot = (): AutosaveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Every editor change: draft now, server soon. */
  edit(change: { doc?: JournalDoc; tags?: string[] }): void {
    this.content = { ...this.content, ...change };
    this.dirty = true;
    this.localEditedAt = this.now().toISOString();
    void this.persistDraft();
    const { status } = this.snapshot;
    if (status === 'conflict') {
      this.update({ unsynced: true });
      return;
    }
    if (status === 'offline') {
      // The retry timer owns the next attempt; don't hammer a dead network.
      this.update({ unsynced: true });
      return;
    }
    this.update({ status: 'pending', unsynced: true });
    this.schedule();
  }

  /** Save now (blur, tab hidden, leaving the page, back online). */
  flush(): Promise<void> {
    this.clearTimers();
    return this.sync();
  }

  /**
   * After a conflict: `keep` saves this copy over the server's (on top of
   * its version); `discard` drops this copy and returns the server's doc for
   * the editor to show.
   */
  async resolveConflict(choice: 'keep' | 'discard'): Promise<JournalEntry | null> {
    const server = this.snapshot.conflict?.server ?? null;
    if (!server) {
      // Could not read the server copy: only "keep" (retry the save) makes sense.
      this.update({ status: 'pending', conflict: null });
      await this.flush();
      return null;
    }
    if (choice === 'keep') {
      this.update({ status: 'pending', conflict: null, version: server.version });
      this.dirty = true;
      await this.persistDraft();
      await this.flush();
      return null;
    }
    this.content = { doc: server.doc, tags: server.tags };
    this.dirty = false;
    await this.options.drafts.delete(this.key);
    this.update({
      status: 'saved',
      conflict: null,
      version: server.version,
      lastSavedAt: server.updatedAt,
      unsynced: false,
    });
    return server;
  }

  /** The entry was deleted: stop everything, never save again. */
  abandon(): void {
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.dirty = false;
    this.listeners.clear();
  }

  /** Stop timers; one last save attempt if anything is unsaved. */
  dispose(): void {
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.dirty && this.snapshot.status !== 'conflict') void this.sync();
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.sync(), this.debounceMs);
    this.maxTimer ??= setTimeout(() => void this.sync(), this.maxWaitMs);
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.debounceTimer = null;
    this.maxTimer = null;
  }

  private sync(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    if (!this.dirty || this.snapshot.status === 'conflict') return Promise.resolve();
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;

    const sent = this.content;
    this.dirty = false;
    this.update({ status: 'saving' });
    this.inFlight = this.send(sent).finally(() => {
      this.inFlight = null;
      if (this.again) {
        this.again = false;
        if (this.dirty && this.snapshot.status === 'pending') void this.sync();
      }
    });
    return this.inFlight;
  }

  private async send(sent: { doc: JournalDoc; tags: string[] }): Promise<void> {
    const { entryId, version } = this.snapshot;
    const keyBefore = this.key;
    try {
      let entry: JournalEntry;
      if (entryId === null || version === null) {
        entry = await this.options.api.create({
          entryDate: this.options.entryDate,
          doc: sent.doc,
          tags: sent.tags,
          promptId: this.options.promptId,
        });
        this.key = draftKeyForEntry(entry.id);
        this.update({ entryId: entry.id });
        this.options.onCreated?.(entry);
      } else {
        entry = await this.options.api.patch(entryId, {
          baseVersion: version,
          doc: sent.doc,
          tags: sent.tags,
        });
      }
      this.retryDelay = this.retryBaseMs;
      this.update({ version: entry.version, lastSavedAt: entry.updatedAt });
      if (this.dirty) {
        // Edited while saving: re-key the draft to the new version (written
        // before the old key goes), then save again.
        await this.persistDraft();
        if (keyBefore !== this.key) await this.options.drafts.delete(keyBefore);
        this.update({ status: 'pending' });
        this.schedule();
      } else {
        if (keyBefore !== this.key) await this.options.drafts.delete(keyBefore);
        await this.options.drafts.delete(this.key);
        if (this.dirty) {
          // An edit landed during the deletes and its draft write may have
          // been removed by them: write it again.
          await this.persistDraft();
          this.update({ status: 'pending' });
          this.schedule();
        } else {
          this.update({ status: 'saved', unsynced: false });
        }
      }
    } catch (error) {
      this.dirty = true;
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 409 && entryId) {
        let server: JournalEntry | null = null;
        try {
          server = await this.options.api.get(entryId);
        } catch {
          server = null;
        }
        this.update({
          status: 'conflict',
          conflict: { server, localEditedAt: this.localEditedAt },
          unsynced: true,
        });
      } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        this.update({ status: 'rejected', unsynced: true });
      } else {
        this.update({ status: 'offline', unsynced: true });
        this.retryTimer = setTimeout(() => void this.sync(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, this.retryMaxMs);
      }
    }
  }

  private async persistDraft(): Promise<void> {
    const draft: JournalDraft = {
      key: this.key,
      entryId: this.snapshot.entryId,
      entryDate: this.options.entryDate,
      promptId: this.options.promptId,
      doc: this.content.doc,
      tags: this.content.tags,
      baseVersion: this.snapshot.version,
      updatedAt: this.localEditedAt,
    };
    try {
      await this.options.drafts.put(draft);
    } catch {
      // The server save is still scheduled; a failed local write is not fatal.
    }
  }

  private update(patch: Partial<AutosaveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/**
 * How to open an entry given the server copy and any local draft:
 * a draft edited from the server's current version is newer work (restore
 * and save it); one edited from an older version is a conflict.
 */
export function reconcileDraft(
  server: JournalEntry | null,
  draft: JournalDraft | null,
): Pick<AutosaveOptions, 'doc' | 'tags' | 'restored' | 'conflict'> | null {
  if (!draft) return null;
  if (!server) return { doc: draft.doc, tags: draft.tags, restored: true };
  if (draft.baseVersion === server.version) {
    return { doc: draft.doc, tags: draft.tags, restored: true };
  }
  return {
    doc: draft.doc,
    tags: draft.tags,
    conflict: { server, localEditedAt: draft.updatedAt },
  };
}
