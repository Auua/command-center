import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';

const STATE_TABLE = 'scheduler_state';
const AUTOMATIONS_TABLE = 'automations';
const RUNS_TABLE = 'automation_runs';
const PROFILES_TABLE = 'user_profiles';
const NOTIFICATIONS_TABLE = 'notifications';
const SUBSCRIPTIONS_TABLE = 'push_subscriptions';

export interface SchedulerState {
  cursorAt: Date;
  lastTickAt: Date | null;
}

export interface RecurringAutomation {
  id: string;
  userId: string;
  cronExpr: string;
  timezone: string;
}

export interface DispatchAutomation {
  id: string;
  userId: string;
  enabled: boolean;
  action: { title: string; body: string | null };
}

export interface PendingRun {
  runId: string;
  automationId: string;
  userId: string;
  slot: Date;
}

export interface SchedulerSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * THE service-role carve-out (ADR-039, §5.1 amendment): the tick and the
 * event-dispatch path carry no user JWT, so this repository — and nothing
 * else in the API — holds a Supabase client built from SUPABASE_SECRET_KEY,
 * which bypasses RLS. Containment rules: consumed only by SchedulerModule's
 * tick/dispatch pipeline, never by a user-facing endpoint; the key is never
 * logged; every query still filters explicitly by the ids it operates on.
 */
@Injectable()
export class SchedulerRepository {
  private readonly logger = new Logger(SchedulerRepository.name);
  private readonly client: SupabaseClient;

  constructor(configService: ConfigService<Env, true>) {
    this.client = createClient(
      configService.get('SUPABASE_URL', { infer: true }),
      configService.get('SUPABASE_SECRET_KEY', { infer: true }),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }

  async getState(name: string): Promise<SchedulerState | null> {
    const { data, error } = await this.client
      .from(STATE_TABLE)
      .select('cursor_at, last_tick_at')
      .eq('name', name)
      .maybeSingle();

    if (error) {
      throw this.wrap('read scheduler state', error.message);
    }
    if (!data) {
      return null;
    }
    const row = data as { cursor_at: string; last_tick_at: string | null };
    return {
      cursorAt: new Date(row.cursor_at),
      lastTickAt: row.last_tick_at ? new Date(row.last_tick_at) : null,
    };
  }

  async upsertState(name: string, cursorAt: Date, lastTickAt: Date): Promise<void> {
    const { error } = await this.client.from(STATE_TABLE).upsert(
      {
        name,
        cursor_at: cursorAt.toISOString(),
        last_tick_at: lastTickAt.toISOString(),
      },
      { onConflict: 'name' },
    );

    if (error) {
      throw this.wrap('advance scheduler state', error.message);
    }
  }

  /** Enabled recurring automations joined (two queries) to their owner's timezone. */
  async listEnabledRecurringAutomations(): Promise<RecurringAutomation[]> {
    const { data, error } = await this.client
      .from(AUTOMATIONS_TABLE)
      .select('id, user_id, cron_expr')
      .eq('kind', 'recurring')
      .eq('enabled', true);

    if (error) {
      throw this.wrap('list recurring automations', error.message);
    }
    const rows = (data ?? []) as { id: string; user_id: string; cron_expr: string }[];
    if (rows.length === 0) {
      return [];
    }

    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const { data: profiles, error: profileError } = await this.client
      .from(PROFILES_TABLE)
      .select('user_id, timezone')
      .in('user_id', userIds);

    if (profileError) {
      throw this.wrap('read user timezones', profileError.message);
    }
    const timezoneByUser = new Map(
      ((profiles ?? []) as { user_id: string; timezone: string }[]).map((profile) => [
        profile.user_id,
        profile.timezone,
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      cronExpr: row.cron_expr,
      timezone: timezoneByUser.get(row.user_id) ?? 'UTC',
    }));
  }

  async listEnabledEventAutomations(userId: string, eventKey: string): Promise<{ id: string }[]> {
    const { data, error } = await this.client
      .from(AUTOMATIONS_TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'event')
      .eq('event_key', eventKey)
      .eq('enabled', true);

    if (error) {
      throw this.wrap('list event automations', error.message);
    }
    return (data ?? []) as { id: string }[];
  }

  /**
   * Claim before send (ADR-039): insert 'pending' with ON CONFLICT DO
   * NOTHING on UNIQUE (automation_id, slot). Returns the new run id, or null
   * when another (overlapping) tick already owns the slot.
   */
  async claimRun(automationId: string, userId: string, slot: Date): Promise<string | null> {
    const { data, error } = await this.client
      .from(RUNS_TABLE)
      .upsert(
        {
          automation_id: automationId,
          user_id: userId,
          slot: slot.toISOString(),
          status: 'pending',
        },
        { onConflict: 'automation_id,slot', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      throw this.wrap('claim run', error.message);
    }
    return (data as { id: string } | null)?.id ?? null;
  }

  /** Records an out-of-cap slot as skipped — honest "didn't fire" (ADR-039). */
  async insertSkippedRun(automationId: string, userId: string, slot: Date): Promise<void> {
    const { error } = await this.client.from(RUNS_TABLE).upsert(
      {
        automation_id: automationId,
        user_id: userId,
        slot: slot.toISOString(),
        status: 'skipped',
      },
      { onConflict: 'automation_id,slot', ignoreDuplicates: true },
    );

    if (error) {
      throw this.wrap('record skipped run', error.message);
    }
  }

  async updateRunStatus(
    runId: string,
    status: 'sent' | 'failed' | 'skipped',
    firedAt: Date | null,
    errorText: string | null,
  ): Promise<void> {
    const { error } = await this.client
      .from(RUNS_TABLE)
      .update({
        status,
        fired_at: firedAt ? firedAt.toISOString() : null,
        error: errorText,
      })
      .eq('id', runId);

    if (error) {
      throw this.wrap('update run status', error.message);
    }
  }

  /**
   * Pending rows claimed before `olderThan` — a crashed invocation between
   * claim and status write. Re-processed on the next tick (bounded
   * self-healing retry, ADR-039 step 7).
   */
  async listStalePendingRuns(olderThan: Date): Promise<PendingRun[]> {
    const { data, error } = await this.client
      .from(RUNS_TABLE)
      .select('id, automation_id, user_id, slot')
      .eq('status', 'pending')
      .lt('created_at', olderThan.toISOString());

    if (error) {
      throw this.wrap('list stale pending runs', error.message);
    }
    return (
      (data ?? []) as { id: string; automation_id: string; user_id: string; slot: string }[]
    ).map((row) => ({
      runId: row.id,
      automationId: row.automation_id,
      userId: row.user_id,
      slot: new Date(row.slot),
    }));
  }

  /** Current automation state for the dispatch tail's enabled re-check. */
  async getAutomationForDispatch(automationId: string): Promise<DispatchAutomation | null> {
    const { data, error } = await this.client
      .from(AUTOMATIONS_TABLE)
      .select('id, user_id, enabled, action')
      .eq('id', automationId)
      .maybeSingle();

    if (error) {
      throw this.wrap('read automation for dispatch', error.message);
    }
    if (!data) {
      return null;
    }
    const row = data as {
      id: string;
      user_id: string;
      enabled: boolean;
      action: { title?: unknown; body?: unknown };
    };
    return {
      id: row.id,
      userId: row.user_id,
      enabled: row.enabled,
      action: {
        title: typeof row.action?.title === 'string' ? row.action.title : 'Reminder',
        body: typeof row.action?.body === 'string' ? row.action.body : null,
      },
    };
  }

  /** Writes the bell row — the delivery of record (ADR-039). Returns its id. */
  async insertNotification(
    userId: string,
    title: string,
    body: string | null,
    automationId: string,
  ): Promise<string> {
    const { data, error } = await this.client
      .from(NOTIFICATIONS_TABLE)
      .insert({
        user_id: userId,
        title,
        body,
        source: 'automation',
        automation_id: automationId,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw this.wrap('write bell notification', error?.message ?? 'no row returned');
    }
    return (data as { id: string }).id;
  }

  async listSubscriptions(userId: string): Promise<SchedulerSubscription[]> {
    const { data, error } = await this.client
      .from(SUBSCRIPTIONS_TABLE)
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);

    if (error) {
      throw this.wrap('list push subscriptions', error.message);
    }
    return (data ?? []) as SchedulerSubscription[];
  }

  /** Prunes a dead subscription (push service answered 404/410). */
  async deleteSubscriptionById(id: string): Promise<void> {
    const { error } = await this.client.from(SUBSCRIPTIONS_TABLE).delete().eq('id', id);

    if (error) {
      throw this.wrap('prune push subscription', error.message);
    }
  }

  private wrap(operation: string, message: string): Error {
    this.logger.error(`Failed to ${operation}: ${message}`);
    return new Error(`Scheduler repository failed to ${operation}`);
  }
}
