import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { JournalPromptCategory } from '@command-center/contracts';
import type { Collection } from 'mongodb';
import { MongoService } from '../mongo/mongo.service';
import { JOURNAL_PROMPT_SEED } from './prompts.seed';

const COLLECTION = 'journal_prompts';

/** Stored prompt. Reference data, not user data — no userId. */
export interface JournalPromptDocument {
  _id: string;
  text: Record<string, string>;
  category: JournalPromptCategory;
  active: boolean;
}

/**
 * Owns `journal_prompts` (ADR-016). Seeds on module init, best-effort: the
 * API must boot when Atlas is unreachable (ADR §2), and a failed seed only
 * means no prompt until the next boot.
 */
@Injectable()
export class JournalPromptsRepository implements OnModuleInit {
  private readonly logger = new Logger(JournalPromptsRepository.name);
  private readonly collection: Collection<JournalPromptDocument>;

  constructor(mongoService: MongoService) {
    this.collection = mongoService.collection<JournalPromptDocument>(COLLECTION);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.seed();
    } catch (error) {
      this.logger.warn(
        `Could not seed ${COLLECTION} (MongoDB unreachable?): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** `$setOnInsert` only: a prompt edited by hand is never overwritten. */
  async seed(): Promise<void> {
    await this.collection.bulkWrite(
      JOURNAL_PROMPT_SEED.map((prompt) => ({
        updateOne: {
          filter: { _id: prompt.id },
          update: {
            $setOnInsert: { text: prompt.text, category: prompt.category, active: true },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  /** Active prompts, optionally limited to some categories (empty = all). */
  listActive(categories: readonly JournalPromptCategory[]): Promise<JournalPromptDocument[]> {
    return this.collection
      .find({
        active: true,
        ...(categories.length > 0 ? { category: { $in: [...categories] } } : {}),
      })
      .toArray();
  }
}
