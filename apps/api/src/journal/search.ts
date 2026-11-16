import type { JournalSearchFragment } from '@command-center/contracts';
import { ObjectId, type Document } from 'mongodb';
import type { SearchCompound } from '../mongo/user-scoped.repository';
import type { TimelinePosition } from './cursor';

/**
 * Journal search (ADR-016, step 4C-2) — the pure parts: the Atlas Search
 * index definition, the compound query and the highlight mapping. The
 * repository runs them; nothing here touches Mongo.
 */

export const JOURNAL_SEARCH_INDEX = 'journal_search';

/** Passages of `plainText` returned per hit. */
export const JOURNAL_SEARCH_PASSAGES = 3;

/**
 * Static mapping — only what search reads is indexed. `plainText` is the
 * analysed text (`lucene.standard`: language-neutral, no stemming — a
 * per-locale analyzer is a later change); `tags` is both a token (exact
 * filter) and analysed text (a word query matches a tag); `userId` and
 * `entryDate` are tokens (equality, range, sort); `_id` is the tie-break
 * of the timeline order and the cursor.
 */
export const JOURNAL_SEARCH_DEFINITION: Document = {
  mappings: {
    dynamic: false,
    fields: {
      _id: { type: 'objectId' },
      userId: { type: 'token' },
      entryDate: { type: 'token' },
      plainText: { type: 'string', analyzer: 'lucene.standard' },
      tags: [{ type: 'token' }, { type: 'string', analyzer: 'lucene.standard' }],
    },
  },
};

export interface SearchFilter {
  q: string;
  from?: string;
  to?: string;
  tag?: string;
  after?: TimelinePosition;
}

/** Newest first, like the timeline — so search pages with the same cursor. */
export const JOURNAL_SEARCH_SORT = { entryDate: -1, _id: -1 } as const;

/**
 * Every word of `q` must appear (in the text or a tag); date range, tag and
 * cursor are non-scoring filters. The user filter is added by the
 * repository base class, never here.
 */
export function searchCompound(filter: SearchFilter): SearchCompound {
  const filters: Document[] = [];
  if (filter.from || filter.to) {
    filters.push({
      range: {
        path: 'entryDate',
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      },
    });
  }
  if (filter.tag) filters.push({ equals: { path: 'tags', value: filter.tag } });
  if (filter.after) {
    // Strictly after the position in (entryDate desc, _id desc) order.
    filters.push({
      compound: {
        should: [
          { range: { path: 'entryDate', lt: filter.after.entryDate } },
          {
            compound: {
              filter: [
                { equals: { path: 'entryDate', value: filter.after.entryDate } },
                { range: { path: '_id', lt: new ObjectId(filter.after.id) } },
              ],
            },
          },
        ],
        minimumShouldMatch: 1,
      },
    });
  }
  return {
    must: [
      {
        text: { query: filter.q, path: ['plainText', 'tags'], matchCriteria: 'all' },
      },
    ],
    filter: filters,
  };
}

interface RawHighlight {
  path?: unknown;
  score?: unknown;
  texts?: unknown;
}

/**
 * Atlas `searchHighlights` → passages of fragments, best-scoring first.
 * Only `plainText` passages are kept (a tag hit has nothing to show), and
 * anything malformed is dropped rather than failing the search.
 */
export function toHighlights(raw: unknown): JournalSearchFragment[][] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawHighlight[])
    .filter((passage) => passage.path === 'plainText' && Array.isArray(passage.texts))
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, JOURNAL_SEARCH_PASSAGES)
    .map((passage) =>
      (passage.texts as { value?: unknown; type?: unknown }[])
        .filter((text) => typeof text.value === 'string' && text.value !== '')
        .map((text) => ({ text: text.value as string, hit: text.type === 'hit' })),
    )
    .filter((fragments) => fragments.some((fragment) => fragment.hit));
}

export type SearchIndexState = 'ready' | 'building' | 'missing' | 'failed';

/**
 * State of the named index from `$listSearchIndexes` rows. Atlas marks an
 * index `queryable` once a query against it is answered from the index
 * (READY, and STALE while a new definition builds).
 */
export function searchIndexState(rows: Document[]): SearchIndexState {
  const [row] = rows;
  if (!row) return 'missing';
  if (row.queryable === true) return 'ready';
  return row.status === 'FAILED' ? 'failed' : 'building';
}
