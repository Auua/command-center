import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  JOURNAL_ENTRY_CREATED_EVENT,
  JOURNAL_SCHEMA_VERSION,
  journalDocToMarkdown,
  journalPlainText,
  journalTextPreview,
  journalWordCount,
  type AppreciationPromptLocale,
  type CreateJournalEntryRequestSchema,
  type JournalDoc,
  type JournalEntry,
  type JournalEntryCreatedEvent,
  type JournalExport,
  type JournalListQuery,
  type JournalListResponse,
  type JournalPromptCategory,
  type JournalToday,
  type PatchJournalEntryRequestSchema,
} from '@command-center/contracts';
import type { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { localDateIn, pickPrompt, promptText } from '../common/daily-prompt';
import type { EventContext } from '../common/events/event-context';
import { ProfileService } from '../profile/profile.service';
import { decodeCursor, encodeCursor } from './cursor';
import { JournalPromptsRepository } from './journal-prompts.repository';
import { JournalRepository, type JournalEntryChanges } from './journal.repository';

type CreateRequest = z.output<typeof CreateJournalEntryRequestSchema>;
type PatchRequest = z.output<typeof PatchJournalEntryRequestSchema>;

/** Fields re-derived from the doc on every write — never taken from a client. */
export function deriveText(doc: JournalDoc): {
  plainText: string;
  textPreview: string;
  wordCount: number;
} {
  const plainText = journalPlainText(doc);
  return {
    plainText,
    textPreview: journalTextPreview(plainText),
    wordCount: journalWordCount(plainText),
  };
}

/** Key-order-independent JSON, so "the same doc" means the same content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Business rules for the journal (ADR-016; controllers stay thin). A
 * malformed or foreign entry id is indistinguishable from a missing one:
 * both 404.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly entries: JournalRepository,
    private readonly prompts: JournalPromptsRepository,
    private readonly profile: ProfileService,
    private readonly events: EventEmitter2,
  ) {}

  async create(
    user: AuthenticatedUser,
    request: CreateRequest,
    now: Date = new Date(),
  ): Promise<JournalEntry> {
    const entryDate = request.entryDate ?? localDateIn(await this.profile.getTimezone(user), now);
    const entry = await this.entries.create(user.id, {
      entryDate,
      doc: request.doc,
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      ...deriveText(request.doc),
      tags: request.tags,
      promptId: request.promptId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const event: JournalEntryCreatedEvent = {
      userId: user.id,
      entryId: entry.id,
      entryDate,
      createdAt: entry.createdAt,
    };
    await this.events.emitAsync(JOURNAL_ENTRY_CREATED_EVENT, event, {
      user,
    } satisfies EventContext);
    return entry;
  }

  async get(user: AuthenticatedUser, id: string): Promise<JournalEntry> {
    const entry = await this.entries.findById(user.id, id);
    if (!entry) throw new NotFoundException(`Journal entry "${id}" not found`);
    return entry;
  }

  /**
   * Autosave. Writes only on the version the client edited; anything else
   * is a 409 and nothing changes — except a retry of a save that already
   * landed (version one ahead, same content), which answers 200 with the
   * stored entry so a timed-out request is never a false conflict.
   */
  async patch(user: AuthenticatedUser, id: string, request: PatchRequest): Promise<JournalEntry> {
    const changes: JournalEntryChanges = {};
    if (request.doc) Object.assign(changes, { doc: request.doc }, deriveText(request.doc));
    if (request.tags) changes.tags = request.tags;

    const updated = await this.entries.updateIfVersion(user.id, id, request.baseVersion, changes);
    if (updated) return updated;

    const current = await this.get(user, id);
    const alreadyApplied =
      current.version === request.baseVersion + 1 &&
      (request.doc === undefined || canonical(current.doc) === canonical(request.doc)) &&
      (request.tags === undefined || canonical(current.tags) === canonical(request.tags));
    if (alreadyApplied) return current;
    throw new ConflictException({
      message: `Journal entry "${id}" changed elsewhere (version ${current.version}, edited ${request.baseVersion})`,
      currentVersion: current.version,
    });
  }

  async delete(user: AuthenticatedUser, id: string): Promise<void> {
    if (!(await this.entries.delete(user.id, id))) {
      throw new NotFoundException(`Journal entry "${id}" not found`);
    }
  }

  async list(user: AuthenticatedUser, query: JournalListQuery): Promise<JournalListResponse> {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (after === null) throw new BadRequestException('Malformed cursor');
    const rows = await this.entries.timeline(user.id, {
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

  async today(
    user: AuthenticatedUser,
    locale: AppreciationPromptLocale,
    categories: readonly JournalPromptCategory[],
    now: Date = new Date(),
  ): Promise<JournalToday> {
    const timezone = await this.profile.getTimezone(user);
    const date = localDateIn(timezone, now);
    const [prompts, entry, entriesToday] = await Promise.all([
      this.prompts.listActive(categories),
      this.entries.latestOn(user.id, date),
      this.entries.countOn(user.id, date),
    ]);
    const usable = prompts.flatMap((prompt) => {
      const text = promptText(prompt.text, locale);
      return text ? [{ id: prompt._id, text }] : [];
    });
    return { date, prompt: pickPrompt(usable, user.id, date), entry, entriesToday };
  }

  async export(user: AuthenticatedUser, now: Date = new Date()): Promise<JournalExport> {
    const items = await this.entries.all(user.id);
    return {
      exportedAt: now.toISOString(),
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      items: items.map((entry) => ({ ...entry, markdown: journalDocToMarkdown(entry.doc) })),
    };
  }
}
