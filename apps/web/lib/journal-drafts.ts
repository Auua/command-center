import type { JournalDoc } from '@command-center/contracts';

/**
 * Local drafts for the journal (ADR-016 "never lose writing"): every edit is
 * written here before anything else, and a draft is deleted only after the
 * server confirms the save it holds. IndexedDB in the browser; an in-memory
 * store where IndexedDB is missing or refuses to open (tests, some private
 * windows) — the editor says so, since that copy dies with the tab.
 */

export interface JournalDraft {
  /** `entry:<id>` for a saved entry, `new:<YYYY-MM-DD>` before the first save. */
  key: string;
  entryId: string | null;
  entryDate: string;
  promptId: string | null;
  doc: JournalDoc;
  tags: string[];
  /** The server version this draft was edited from; null before the first save. */
  baseVersion: number | null;
  /** ISO time of the last local edit. */
  updatedAt: string;
}

export interface DraftStore {
  /** False for the in-memory fallback: drafts there do not survive a reload. */
  readonly durable: boolean;
  get(key: string): Promise<JournalDraft | null>;
  put(draft: JournalDraft): Promise<void>;
  delete(key: string): Promise<void>;
}

export const draftKeyForEntry = (id: string): string => `entry:${id}`;
export const draftKeyForNew = (entryDate: string): string => `new:${entryDate}`;

export function createMemoryDraftStore(): DraftStore {
  const drafts = new Map<string, JournalDraft>();
  return {
    durable: false,
    get: async (key) => drafts.get(key) ?? null,
    put: async (draft): Promise<void> => {
      drafts.set(draft.key, structuredClone(draft));
    },
    delete: async (key): Promise<void> => {
      drafts.delete(key);
    },
  };
}

const DB_NAME = 'cc-journal';
const STORE = 'drafts';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = (): void => reject(new Error('IndexedDB open blocked'));
  });
}

function createIndexedDbDraftStore(db: IDBDatabase): DraftStore {
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => promisify(action(db.transaction(STORE, mode).objectStore(STORE)));
  return {
    durable: true,
    get: async (key) =>
      ((await run('readonly', (store) => store.get(key))) as JournalDraft) ?? null,
    put: async (draft): Promise<void> => {
      await run('readwrite', (store) => store.put(draft));
    },
    delete: async (key): Promise<void> => {
      await run('readwrite', (store) => store.delete(key));
    },
  };
}

let opened: Promise<DraftStore> | null = null;

/** The browser's draft store, opened once per page; falls back to memory. */
export function getDraftStore(): Promise<DraftStore> {
  opened ??= (async (): Promise<DraftStore> => {
    if (typeof indexedDB === 'undefined') return createMemoryDraftStore();
    try {
      return createIndexedDbDraftStore(await openDatabase());
    } catch {
      return createMemoryDraftStore();
    }
  })();
  return opened;
}
