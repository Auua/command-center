import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { AppreciationEntrySchema, type AppreciationEntry } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const ENTRIES = 'appreciation_entries';
const PROMPTS = 'appreciation_prompts';
const COLUMNS = 'id, text, tags, created_at';
/** PostgREST's default max-rows; the export pages through in steps this size. */
export const EXPORT_PAGE = 1000;

interface EntryRow {
  id: string;
  text: string;
  tags: string[] | null;
  created_at: string;
}

export interface PromptRow {
  id: string;
  text: Record<string, unknown>;
}

function toIso(value: string): string {
  const time = Date.parse(value);
  // NaN → keep the raw value so schema validation reports the corruption.
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

/**
 * Persistence for appreciation entries and the seeded prompts (ADR-017,
 * Postgres). Every query runs through an RLS-scoped client built from the
 * caller's own JWT; the explicit `user_id` filters (from the token, never the
 * body) are a second, application-level net (ADR §5.1).
 */
@Injectable()
export class AppreciationRepository {
  private readonly logger = new Logger(AppreciationRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** The newest `limit` entries. */
  async listRecentForUser(user: AuthenticatedUser, limit: number): Promise<AppreciationEntry[]> {
    return this.page(user, 0, limit - 1);
  }

  /** Every entry, newest first, fetched in pages (export). */
  async listAllForUser(user: AuthenticatedUser): Promise<AppreciationEntry[]> {
    const all: AppreciationEntry[] = [];
    for (let from = 0; ; from += EXPORT_PAGE) {
      const page = await this.page(user, from, from + EXPORT_PAGE - 1);
      all.push(...page);
      if (page.length < EXPORT_PAGE) return all;
    }
  }

  async createForUser(
    user: AuthenticatedUser,
    values: { text: string; tags: string[] },
  ): Promise<AppreciationEntry> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(ENTRIES)
      .insert({ user_id: user.id, ...values })
      .select(COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create appreciation entry: ${error?.message}`);
      throw new InternalServerErrorException('Failed to create appreciation entry');
    }
    return this.toEntry(data as EntryRow);
  }

  /** Returns false when no owned row matched the id. */
  async deleteForUser(user: AuthenticatedUser, id: string): Promise<boolean> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(ENTRIES)
      .delete()
      .eq('user_id', user.id)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      // A malformed uuid is a "no such entry", not a server fault.
      if (error.code === '22P02') return false;
      this.logger.error(`Failed to delete appreciation entry: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete appreciation entry');
    }
    return data !== null;
  }

  /** Active prompts (reference data — readable by any signed-in user). */
  async listActivePrompts(user: AuthenticatedUser): Promise<PromptRow[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(PROMPTS)
      .select('id, text')
      .eq('active', true)
      .order('id', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list appreciation prompts: ${error.message}`);
      throw new InternalServerErrorException('Failed to list appreciation prompts');
    }
    return ((data ?? []) as PromptRow[]).filter(
      (row) => typeof row.id === 'string' && row.text !== null && typeof row.text === 'object',
    );
  }

  private async page(
    user: AuthenticatedUser,
    from: number,
    to: number,
  ): Promise<AppreciationEntry[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(ENTRIES)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to list appreciation entries: ${error.message}`);
      throw new InternalServerErrorException('Failed to list appreciation entries');
    }
    return ((data ?? []) as EntryRow[]).map((row) => this.toEntry(row));
  }

  /**
   * Maps a DB row to the contract shape. Parse failures here mean corrupt
   * stored data, so they surface as 500s — never as client-facing ZodErrors.
   */
  private toEntry(row: EntryRow): AppreciationEntry {
    const parsed = AppreciationEntrySchema.safeParse({
      id: row.id,
      text: row.text,
      tags: row.tags ?? [],
      createdAt: toIso(row.created_at),
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored appreciation entry "${row.id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored appreciation entry is invalid');
    }
    return parsed.data;
  }
}
