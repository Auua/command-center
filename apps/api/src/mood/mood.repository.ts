import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { MoodCheckinSchema, type MoodCheckin } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'mood_checkins';
const COLUMNS = 'id, mood_score, tags, note, created_at';

function toIso(value: string): string {
  const time = Date.parse(value);
  // NaN → keep the raw value so schema validation reports the corruption.
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

interface MoodCheckinRow {
  id: string;
  mood_score: number;
  tags: string[] | null;
  note: string | null;
  created_at: string;
}

/**
 * Persistence for mood check-ins (ADR §4.4 — Postgres `mood_checkins`).
 *
 * Every query runs through an RLS-scoped client built from the caller's own
 * JWT; the explicit `user_id` filters (from the token, never the body) are a
 * second, application-level net (ADR §5.1).
 */
@Injectable()
export class MoodRepository {
  private readonly logger = new Logger(MoodRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Check-ins at or after `sinceIso`, newest first. */
  async listSinceForUser(user: AuthenticatedUser, sinceIso: string): Promise<MoodCheckin[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list mood check-ins: ${error.message}`);
      throw new InternalServerErrorException('Failed to list mood check-ins');
    }
    return ((data ?? []) as MoodCheckinRow[]).map((row) => this.toCheckin(row));
  }

  async createForUser(
    user: AuthenticatedUser,
    values: { mood_score: number; tags: string[]; note: string | null },
  ): Promise<MoodCheckin> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: user.id, ...values })
      .select(COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create mood check-in: ${error?.message}`);
      throw new InternalServerErrorException('Failed to create mood check-in');
    }
    return this.toCheckin(data as MoodCheckinRow);
  }

  /** Returns false when no owned row matched the id. */
  async deleteForUser(user: AuthenticatedUser, id: string): Promise<boolean> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      // A malformed uuid is a "no such check-in", not a server fault.
      if (error.code === '22P02') return false;
      this.logger.error(`Failed to delete mood check-in: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete mood check-in');
    }
    return data !== null;
  }

  /**
   * Maps a DB row to the contract shape. Parse failures here mean corrupt
   * stored data, so they surface as 500s — never as client-facing ZodErrors
   * (those are reserved for request validation).
   */
  private toCheckin(row: MoodCheckinRow): MoodCheckin {
    const parsed = MoodCheckinSchema.safeParse({
      id: row.id,
      score: row.mood_score,
      tags: row.tags ?? [],
      note: row.note,
      // PostgREST serializes timestamptz with a +00:00 offset; the contract
      // wants strict UTC "Z" datetimes, so normalize through Date.
      createdAt: toIso(row.created_at),
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored mood check-in "${row.id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored mood check-in is invalid');
    }
    return parsed.data;
  }
}
