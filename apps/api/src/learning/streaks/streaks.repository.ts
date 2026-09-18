import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SupabaseService } from '../../supabase/supabase.service';
import type { StreakRow } from './streak-math';

const STREAKS_TABLE = 'streaks';
const DAYS_TABLE = 'streak_days';

export interface StreakRowWithKey extends StreakRow {
  streakKey: string;
}

/**
 * Persistence for `streaks` + `streak_days` (ADR-014), RLS-scoped under the
 * caller's JWT — the writer is the request that emitted the source event
 * (EventContext), never a service-role path.
 */
@Injectable()
export class StreaksRepository {
  private readonly logger = new Logger(StreaksRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Insert the day mark; false when it already existed (idempotent event delivery). */
  async insertDay(user: AuthenticatedUser, streakKey: string, localDate: string): Promise<boolean> {
    const client = this.supabaseService.forUser(user.token);
    const { error } = await client
      .from(DAYS_TABLE)
      .insert({ user_id: user.id, streak_key: streakKey, local_date: localDate });
    if (error) {
      if (error.code === '23505') return false;
      throw this.wrap('record streak day', error.message);
    }
    return true;
  }

  async getRow(user: AuthenticatedUser, streakKey: string): Promise<StreakRow | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(STREAKS_TABLE)
      .select('current_len, best_len, last_active_date')
      .eq('user_id', user.id)
      .eq('widget_id', streakKey)
      .maybeSingle();
    if (error) throw this.wrap('read streak', error.message);
    return data ? this.toRow(data as RawRow) : null;
  }

  async upsertRow(user: AuthenticatedUser, streakKey: string, row: StreakRow): Promise<void> {
    const client = this.supabaseService.forUser(user.token);
    const { error } = await client.from(STREAKS_TABLE).upsert(
      {
        user_id: user.id,
        widget_id: streakKey,
        current_len: row.currentLen,
        best_len: row.bestLen,
        last_active_date: row.lastActiveDate,
      },
      { onConflict: 'user_id,widget_id' },
    );
    if (error) throw this.wrap('write streak', error.message);
  }

  async listRows(user: AuthenticatedUser): Promise<StreakRowWithKey[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(STREAKS_TABLE)
      .select('widget_id, current_len, best_len, last_active_date')
      .eq('user_id', user.id);
    if (error) throw this.wrap('list streaks', error.message);
    return ((data ?? []) as (RawRow & { widget_id: string })[]).map((raw) => ({
      streakKey: raw.widget_id,
      ...this.toRow(raw),
    }));
  }

  /** Day marks in [from, to] as `Map<streakKey, Set<localDate>>`. */
  async listDays(
    user: AuthenticatedUser,
    from: string,
    to: string,
  ): Promise<Map<string, Set<string>>> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(DAYS_TABLE)
      .select('streak_key, local_date')
      .eq('user_id', user.id)
      .gte('local_date', from)
      .lte('local_date', to);
    if (error) throw this.wrap('list streak days', error.message);
    const out = new Map<string, Set<string>>();
    for (const raw of (data ?? []) as { streak_key: string; local_date: string }[]) {
      const set = out.get(raw.streak_key) ?? new Set<string>();
      set.add(raw.local_date.slice(0, 10));
      out.set(raw.streak_key, set);
    }
    return out;
  }

  private toRow(raw: RawRow): StreakRow {
    return {
      currentLen: raw.current_len,
      bestLen: raw.best_len,
      lastActiveDate: raw.last_active_date ? raw.last_active_date.slice(0, 10) : null,
    };
  }

  private wrap(what: string, detail: string): InternalServerErrorException {
    this.logger.error(`Failed to ${what}: ${detail}`);
    return new InternalServerErrorException(`Failed to ${what}`);
  }
}

interface RawRow {
  current_len: number;
  best_len: number;
  last_active_date: string | null;
}
