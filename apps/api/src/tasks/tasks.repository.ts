import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { TaskSchema, type Task } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'tasks';

function toIsoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  // NaN → keep the raw value so schema validation reports the corruption.
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}
const COLUMNS = 'id, title, priority, tags, deadline, completed_at, created_at, updated_at';

/** Column values for an update; keys map 1:1 to the tasks table. */
export interface TaskPatch {
  title?: string;
  priority?: number | null;
  tags?: string[];
  deadline?: string | null;
  completed_at?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  priority: number | null;
  tags: string[] | null;
  deadline: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Persistence for tasks (ADR §4.4 — first Postgres-backed domain module,
 * the relational half of ADR-003).
 *
 * Every query runs through an RLS-scoped client built from the caller's own
 * JWT; the explicit `user_id` filters (from the token, never the body) are a
 * second, application-level net (ADR §5.1).
 */
@Injectable()
export class TasksRepository {
  private readonly logger = new Logger(TasksRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Completed tasks first (matching the design mock's "Today's tasks" card,
   * where finished items sit ticked-off at the top), then open tasks by
   * priority, then deadline.
   */
  async listForUser(user: AuthenticatedUser): Promise<Task[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .order('completed_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: true, nullsFirst: false })
      .order('deadline', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list tasks: ${error.message}`);
      throw new InternalServerErrorException('Failed to list tasks');
    }
    return ((data ?? []) as TaskRow[]).map((row) => this.toTask(row));
  }

  async createForUser(
    user: AuthenticatedUser,
    values: {
      title: string;
      priority: number | null;
      tags: string[];
      deadline: string | null;
    },
  ): Promise<Task> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: user.id, ...values })
      .select(COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create task: ${error?.message}`);
      throw new InternalServerErrorException('Failed to create task');
    }
    return this.toTask(data as TaskRow);
  }

  /** Returns the updated task, or null when no owned row matches the id. */
  async updateForUser(user: AuthenticatedUser, id: string, patch: TaskPatch): Promise<Task | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .update(patch)
      .eq('user_id', user.id)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();

    if (error) {
      // A malformed uuid is a "no such task", not a server fault.
      if (error.code === '22P02') return null;
      this.logger.error(`Failed to update task: ${error.message}`);
      throw new InternalServerErrorException('Failed to update task');
    }
    return data ? this.toTask(data as TaskRow) : null;
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
      this.logger.error(`Failed to delete task: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete task');
    }
    return data !== null;
  }

  /**
   * Maps a DB row to the contract shape. Parse failures here mean corrupt
   * stored data, so they surface as 500s — never as client-facing ZodErrors
   * (those are reserved for request validation).
   */
  private toTask(row: TaskRow): Task {
    const parsed = TaskSchema.safeParse({
      id: row.id,
      title: row.title,
      priority: row.priority,
      tags: row.tags ?? [],
      deadline: row.deadline,
      // PostgREST serializes timestamptz with a +00:00 offset; the contract
      // wants strict UTC "Z" datetimes, so normalize through Date.
      completedAt: toIsoOrNull(row.completed_at),
      createdAt: toIsoOrNull(row.created_at),
      updatedAt: toIsoOrNull(row.updated_at),
    });
    if (!parsed.success) {
      this.logger.error(`Stored task "${row.id}" does not match contract: ${parsed.error.message}`);
      throw new InternalServerErrorException('Stored task is invalid');
    }
    return parsed.data;
  }
}
