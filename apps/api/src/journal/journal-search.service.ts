import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { JournalSearchQuery, JournalSearchResponse } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { decodeCursor, encodeCursor } from './cursor';
import { JournalRepository } from './journal.repository';
import { JOURNAL_SEARCH_INDEX, type SearchIndexState } from './search';

/** How long a "not ready" answer is trusted before Atlas is asked again. */
export const SEARCH_RECHECK_MS = 30_000;

type IndexCheck = SearchIndexState | 'unsupported';

/**
 * Journal full-text search (ADR-016, step 4C-2) over the Atlas Search index
 * `journal_search`.
 *
 * The API creates the index itself when it is missing — on boot and again
 * on a search while it is not ready — so there is no manual Atlas step
 * (the app's database user has `readWrite`, which carries
 * `createSearchIndexes`). Atlas builds it in the background; until it is
 * queryable, and on deployments without Atlas Search (the e2e
 * mongodb-memory-server), a search answers 503 instead of a silently empty
 * result — `$search` against a missing index returns no documents rather
 * than an error.
 */
@Injectable()
export class JournalSearchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JournalSearchService.name);
  private ready = false;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<IndexCheck> | null = null;

  constructor(private readonly entries: JournalRepository) {}

  onApplicationBootstrap(): void {
    void this.check(Date.now());
  }

  async search(user: AuthenticatedUser, query: JournalSearchQuery): Promise<JournalSearchResponse> {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (after === null) throw new BadRequestException('Malformed cursor');
    if (!(await this.isReady())) {
      throw new ServiceUnavailableException('Journal search is not available yet');
    }
    const rows = await this.entries.search(user.id, {
      q: query.q,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.tag ? { tag: query.tag } : {}),
      ...(after ? { after } : {}),
      limit: query.limit,
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ entryDate: last.entryDate, id: last.id })
          : null,
    };
  }

  /** Ready stays ready; "not ready" is re-asked at most every SEARCH_RECHECK_MS. */
  async isReady(now: number = Date.now()): Promise<boolean> {
    if (this.ready) return true;
    if (now - this.checkedAt < SEARCH_RECHECK_MS && !this.inFlight) return false;
    return (await this.check(now)) === 'ready';
  }

  /** One check at a time; never throws. */
  private check(now: number): Promise<IndexCheck> {
    if (!this.inFlight) {
      this.checkedAt = now;
      this.inFlight = this.ensureIndex().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async ensureIndex(): Promise<IndexCheck> {
    try {
      const state = await this.entries.searchIndexState();
      if (state === 'ready') {
        this.ready = true;
      } else if (state === 'missing') {
        await this.entries.createJournalSearchIndex();
        this.logger.log(`Created Atlas Search index ${JOURNAL_SEARCH_INDEX}; Atlas is building it`);
        return 'building';
      } else if (state === 'failed') {
        this.logger.warn(
          `Atlas Search index ${JOURNAL_SEARCH_INDEX} failed to build — check it in the Atlas UI`,
        );
      }
      return state;
    } catch (error) {
      this.logger.warn(
        `Journal search unavailable (not Atlas, or the database user cannot manage search indexes): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'unsupported';
    }
  }
}
