import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  AutomationRunSchema,
  AutomationSchema,
  type Automation,
  type AutomationAction,
  type AutomationRun,
  type EventKey,
  type Schedule,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'automations';
const RUNS_TABLE = 'automation_runs';
// cron_expr is deliberately not selected: it is engine-internal and never
// crosses the wire (ADR-015 — raw cron never reaches the UI).
const COLUMNS = 'id, name, kind, schedule, event_key, action, enabled, created_at, updated_at';
const RUN_COLUMNS = 'id, slot, status, fired_at, error, created_at';

function toIsoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  // NaN → keep the raw value so schema validation reports the corruption.
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

interface AutomationRow {
  id: string;
  name: string;
  kind: string;
  schedule: unknown;
  event_key: string | null;
  action: unknown;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  slot: string;
  status: string;
  fired_at: string | null;
  error: string | null;
  created_at: string;
}

/** Windowed run row for the today view (no contract mapping needed). */
export interface RunSlotRow {
  automationId: string;
  slot: string;
  status: string;
  firedAt: string | null;
}

export interface AutomationInsert {
  name: string;
  kind: 'recurring' | 'event';
  schedule: Schedule | null;
  cron_expr: string | null;
  event_key: EventKey | null;
  action: AutomationAction;
  enabled: boolean;
}

/** Column values for an update; keys map 1:1 to the automations table. */
export interface AutomationPatch {
  name?: string;
  schedule?: Schedule;
  cron_expr?: string;
  action?: AutomationAction;
  enabled?: boolean;
}

/**
 * Persistence for automations (ADR §4.4; ADR-015). RLS-scoped under the
 * caller's JWT like every user-facing repository; the scheduler's
 * service-role path (SchedulerModule) is the only other reader and the only
 * writer of `automation_runs`.
 */
@Injectable()
export class AutomationRepository {
  private readonly logger = new Logger(AutomationRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listForUser(user: AuthenticatedUser): Promise<Automation[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list automations: ${error.message}`);
      throw new InternalServerErrorException('Failed to list automations');
    }
    return ((data ?? []) as AutomationRow[]).map((row) => this.toAutomation(row));
  }

  /** Returns null when no owned row matches the id (404-not-403). */
  async getForUser(user: AuthenticatedUser, id: string): Promise<Automation | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      // A malformed uuid is a "no such automation", not a server fault.
      if (error.code === '22P02') return null;
      this.logger.error(`Failed to read automation: ${error.message}`);
      throw new InternalServerErrorException('Failed to read automation');
    }
    return data ? this.toAutomation(data as AutomationRow) : null;
  }

  async createForUser(user: AuthenticatedUser, values: AutomationInsert): Promise<Automation> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: user.id, ...values })
      .select(COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create automation: ${error?.message}`);
      throw new InternalServerErrorException('Failed to create automation');
    }
    return this.toAutomation(data as AutomationRow);
  }

  /** Returns the updated automation, or null when no owned row matches. */
  async updateForUser(
    user: AuthenticatedUser,
    id: string,
    patch: AutomationPatch,
  ): Promise<Automation | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .update(patch)
      .eq('user_id', user.id)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();

    if (error) {
      if (error.code === '22P02') return null;
      this.logger.error(`Failed to update automation: ${error.message}`);
      throw new InternalServerErrorException('Failed to update automation');
    }
    return data ? this.toAutomation(data as AutomationRow) : null;
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
      if (error.code === '22P02') return false;
      this.logger.error(`Failed to delete automation: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete automation');
    }
    return data !== null;
  }

  /** Recent runs of one automation, newest slot first (ADR-015 history tab). */
  async listRunsForAutomation(
    user: AuthenticatedUser,
    automationId: string,
    limit: number,
  ): Promise<AutomationRun[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(RUNS_TABLE)
      .select(RUN_COLUMNS)
      .eq('user_id', user.id)
      .eq('automation_id', automationId)
      .order('slot', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to list automation runs: ${error.message}`);
      throw new InternalServerErrorException('Failed to list automation runs');
    }
    return ((data ?? []) as RunRow[]).map((row) => this.toRun(row));
  }

  /** All of the user's runs with slots inside [start, end] (today view join). */
  async listRunsInWindow(user: AuthenticatedUser, start: Date, end: Date): Promise<RunSlotRow[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(RUNS_TABLE)
      .select('automation_id, slot, status, fired_at')
      .eq('user_id', user.id)
      .gte('slot', start.toISOString())
      .lte('slot', end.toISOString());

    if (error) {
      this.logger.error(`Failed to list runs in window: ${error.message}`);
      throw new InternalServerErrorException('Failed to list runs');
    }
    return (
      (data ?? []) as {
        automation_id: string;
        slot: string;
        status: string;
        fired_at: string | null;
      }[]
    ).map((row) => ({
      automationId: row.automation_id,
      slot: toIsoOrNull(row.slot) ?? row.slot,
      status: row.status,
      firedAt: toIsoOrNull(row.fired_at),
    }));
  }

  /** Latest run per automation id (event rows' lastRun in the today view). */
  async listLatestRuns(user: AuthenticatedUser, automationIds: string[]): Promise<RunSlotRow[]> {
    if (automationIds.length === 0) {
      return [];
    }
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(RUNS_TABLE)
      .select('automation_id, slot, status, fired_at')
      .eq('user_id', user.id)
      .in('automation_id', automationIds)
      .order('slot', { ascending: false })
      .limit(100);

    if (error) {
      this.logger.error(`Failed to list latest runs: ${error.message}`);
      throw new InternalServerErrorException('Failed to list runs');
    }
    const latest = new Map<string, RunSlotRow>();
    for (const row of (data ?? []) as {
      automation_id: string;
      slot: string;
      status: string;
      fired_at: string | null;
    }[]) {
      if (!latest.has(row.automation_id)) {
        latest.set(row.automation_id, {
          automationId: row.automation_id,
          slot: toIsoOrNull(row.slot) ?? row.slot,
          status: row.status,
          firedAt: toIsoOrNull(row.fired_at),
        });
      }
    }
    return [...latest.values()];
  }

  private toAutomation(row: AutomationRow): Automation {
    const parsed = AutomationSchema.safeParse({
      id: row.id,
      name: row.name,
      kind: row.kind,
      schedule: row.schedule,
      eventKey: row.event_key,
      action: row.action,
      enabled: row.enabled,
      createdAt: toIsoOrNull(row.created_at),
      updatedAt: toIsoOrNull(row.updated_at),
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored automation "${row.id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored automation is invalid');
    }
    return parsed.data;
  }

  private toRun(row: RunRow): AutomationRun {
    const parsed = AutomationRunSchema.safeParse({
      id: row.id,
      slot: toIsoOrNull(row.slot),
      status: row.status,
      firedAt: toIsoOrNull(row.fired_at),
      error: row.error,
      createdAt: toIsoOrNull(row.created_at),
    });
    if (!parsed.success) {
      this.logger.error(`Stored run "${row.id}" does not match contract: ${parsed.error.message}`);
      throw new InternalServerErrorException('Stored automation run is invalid');
    }
    return parsed.data;
  }
}
