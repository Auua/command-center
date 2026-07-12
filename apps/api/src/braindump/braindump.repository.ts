import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { BraindumpNote } from '@command-center/contracts';
import { ObjectId, type WithId } from 'mongodb';
import { MongoService } from '../mongo/mongo.service';
import { UserScopedRepository, type UserOwnedDocument } from '../mongo/user-scoped.repository';

const COLLECTION = 'braindump_notes';

/** Newest first; capped so a runaway braindump can't blow up the widget. */
const LIST_LIMIT = 200;

/**
 * Stored shape of a braindump note. Document-flexible by design (ADR-003):
 * new optional fields may be added over time; only the fields mapped into
 * the contract are load-bearing.
 */
interface BraindumpNoteDocument extends UserOwnedDocument {
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Owns the `braindump_notes` collection exclusively (ARD §4.4). All access
 * goes through the user-scoped base class, so every query carries the
 * caller's userId.
 */
@Injectable()
export class BraindumpRepository
  extends UserScopedRepository<BraindumpNoteDocument>
  implements OnModuleInit
{
  private readonly logger = new Logger(BraindumpRepository.name);

  constructor(mongoService: MongoService) {
    super(mongoService.collection<BraindumpNoteDocument>(COLLECTION));
  }

  /**
   * Best-effort index for the list query. Failure is logged, not fatal: the
   * API must boot even when Atlas is unreachable (ARD §2 failure posture).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndexes();
    } catch (error) {
      this.logger.warn(
        `Could not ensure ${COLLECTION} indexes (MongoDB unreachable?): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listForUser(userId: string): Promise<BraindumpNote[]> {
    const docs = await this.findForUser(userId, {}, { sort: { createdAt: -1 }, limit: LIST_LIMIT });
    return docs.map((doc) => this.toNote(doc));
  }

  async createForUser(userId: string, content: string): Promise<BraindumpNote> {
    const now = new Date();
    const doc = await this.insertForUser(userId, {
      content,
      createdAt: now,
      updatedAt: now,
    });
    return this.toNote(doc);
  }

  /** Returns null when the id is malformed or the note isn't the user's. */
  async updateContentForUser(
    userId: string,
    id: string,
    content: string,
  ): Promise<BraindumpNote | null> {
    const _id = this.parseId(id);
    if (!_id) return null;
    const doc = await this.updateOneForUser(userId, { _id }, { content, updatedAt: new Date() });
    return doc ? this.toNote(doc) : null;
  }

  /** Returns false when the id is malformed or the note isn't the user's. */
  async deleteForUser(userId: string, id: string): Promise<boolean> {
    const _id = this.parseId(id);
    if (!_id) return false;
    return this.deleteOneForUser(userId, { _id });
  }

  private parseId(id: string): ObjectId | null {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  }

  private toNote(doc: WithId<BraindumpNoteDocument>): BraindumpNote {
    return {
      id: doc._id.toHexString(),
      content: doc.content,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private async ensureIndexes(): Promise<void> {
    await this.createIndex({ userId: 1, createdAt: -1 });
  }
}
