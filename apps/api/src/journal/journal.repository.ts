import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { JournalDoc, JournalEntry, JournalEntrySummary } from '@command-center/contracts';
import { ObjectId, type Filter, type WithId } from 'mongodb';
import { MongoService } from '../mongo/mongo.service';
import { UserScopedRepository, type UserOwnedDocument } from '../mongo/user-scoped.repository';
import type { TimelinePosition } from './cursor';

const COLLECTION = 'journal_entries';

/** Stored shape of a journal entry (ADR-016 data model). */
export interface JournalEntryDocument extends UserOwnedDocument {
  entryDate: string;
  doc: JournalDoc;
  schemaVersion: number;
  /** Server-derived from `doc` on every write — the search source. */
  plainText: string;
  textPreview: string;
  wordCount: number;
  tags: string[];
  promptId: string | null;
  /** Optimistic-concurrency counter; starts at 1. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewJournalEntry = Omit<JournalEntryDocument, 'userId' | '_id'>;
export type JournalEntryChanges = Partial<
  Pick<JournalEntryDocument, 'doc' | 'plainText' | 'textPreview' | 'wordCount' | 'tags'>
>;

export interface TimelineFilter {
  from?: string;
  to?: string;
  tag?: string;
  after?: TimelinePosition;
  limit: number;
}

/**
 * Owns `journal_entries` exclusively (ADR-016, ADR-002). Every read and
 * write goes through the user-scoped base class.
 */
@Injectable()
export class JournalRepository
  extends UserScopedRepository<JournalEntryDocument>
  implements OnModuleInit
{
  private readonly logger = new Logger(JournalRepository.name);

  constructor(mongoService: MongoService) {
    super(mongoService.collection<JournalEntryDocument>(COLLECTION));
  }

  async onModuleInit(): Promise<void> {
    try {
      // Timeline order (and the day lookup), then the tag filter.
      await this.createIndex({ userId: 1, entryDate: -1, _id: -1 });
      await this.createIndex({ userId: 1, tags: 1, entryDate: -1 });
    } catch (error) {
      this.logger.warn(
        `Could not ensure ${COLLECTION} indexes (MongoDB unreachable?): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async create(userId: string, entry: NewJournalEntry): Promise<JournalEntry> {
    return toEntry(await this.insertForUser(userId, entry));
  }

  async findById(userId: string, id: string): Promise<JournalEntry | null> {
    const _id = parseId(id);
    if (!_id) return null;
    const [doc] = await this.findForUser(userId, { _id }, { limit: 1 });
    return doc ? toEntry(doc) : null;
  }

  /**
   * Writes `changes` only if the stored version is still `baseVersion`, and
   * bumps it. Null when the entry is missing or the version moved on.
   */
  async updateIfVersion(
    userId: string,
    id: string,
    baseVersion: number,
    changes: JournalEntryChanges,
    now: Date = new Date(),
  ): Promise<JournalEntry | null> {
    const _id = parseId(id);
    if (!_id) return null;
    const doc = await this.updateOneForUser(
      userId,
      { _id, version: baseVersion },
      { ...changes, version: baseVersion + 1, updatedAt: now },
    );
    return doc ? toEntry(doc) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const _id = parseId(id);
    if (!_id) return false;
    return this.deleteOneForUser(userId, { _id });
  }

  /** Newest first; one more than `limit` is read so the caller knows if a page follows. */
  async timeline(userId: string, filter: TimelineFilter): Promise<JournalEntrySummary[]> {
    const clauses: Filter<JournalEntryDocument>[] = [];
    if (filter.from || filter.to) {
      clauses.push({
        entryDate: {
          ...(filter.from ? { $gte: filter.from } : {}),
          ...(filter.to ? { $lte: filter.to } : {}),
        },
      });
    }
    if (filter.tag) clauses.push({ tags: filter.tag });
    if (filter.after) {
      const afterId = new ObjectId(filter.after.id);
      clauses.push({
        $or: [
          { entryDate: { $lt: filter.after.entryDate } },
          { entryDate: filter.after.entryDate, _id: { $lt: afterId } },
        ],
      });
    }
    const docs = await this.findForUser(userId, clauses.length > 0 ? { $and: clauses } : {}, {
      sort: { entryDate: -1, _id: -1 },
      limit: filter.limit + 1,
    });
    return docs.map(toSummary);
  }

  async latestOn(userId: string, entryDate: string): Promise<JournalEntrySummary | null> {
    const [doc] = await this.findForUser(userId, { entryDate }, { sort: { _id: -1 }, limit: 1 });
    return doc ? toSummary(doc) : null;
  }

  countOn(userId: string, entryDate: string): Promise<number> {
    return this.countForUser(userId, { entryDate });
  }

  async all(userId: string): Promise<JournalEntry[]> {
    const docs = await this.findForUser(userId, {}, { sort: { entryDate: -1, _id: -1 } });
    return docs.map(toEntry);
  }
}

function parseId(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function toSummary(doc: WithId<JournalEntryDocument>): JournalEntrySummary {
  return {
    id: doc._id.toHexString(),
    entryDate: doc.entryDate,
    textPreview: doc.textPreview,
    wordCount: doc.wordCount,
    tags: doc.tags,
    promptId: doc.promptId,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toEntry(doc: WithId<JournalEntryDocument>): JournalEntry {
  return { ...toSummary(doc), doc: doc.doc, schemaVersion: doc.schemaVersion };
}
