import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  CalendarEventSchema,
  type CalendarEvent,
  type CalendarEventWriteParsed,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'calendar_events';
const COLUMNS =
  'id, title, location, note, rrule, exdates, time_zone, all_day, starts_at, ends_at, starts_on, ends_on, created_at, updated_at';

interface EventRow {
  id: string;
  title: string;
  location: string | null;
  note: string | null;
  rrule: string | null;
  exdates: string[] | null;
  time_zone: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
}

/** What the service stores for an event — the write body plus its zone and exceptions. */
export interface EventValues {
  event: CalendarEventWriteParsed;
  timeZone: string;
  exdates: string[];
}

export interface RangeBounds {
  /** Instants bounding the range (timed events overlap them). */
  startsBefore: string;
  endsAfter: string;
  /** Dates bounding it (all-day events, inclusive end). */
  fromDate: string;
  toDate: string;
}

function toIso(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

function toRow(values: EventValues): Record<string, unknown> {
  const { event } = values;
  return {
    title: event.title,
    location: event.location,
    note: event.note,
    rrule: event.rrule,
    exdates: values.exdates,
    time_zone: values.timeZone,
    all_day: event.allDay,
    starts_at: event.allDay ? null : event.startsAt,
    ends_at: event.allDay ? null : event.endsAt,
    starts_on: event.allDay ? event.startsOn : null,
    ends_on: event.allDay ? event.endsOn : null,
  };
}

/**
 * Persistence for `calendar_events` (ADR-018, Postgres). Every query runs
 * through an RLS-scoped client built from the caller's own JWT; the
 * explicit `user_id` filters (from the token, never the body) are a second
 * net (ADR §5.1).
 */
@Injectable()
export class CalendarRepository {
  private readonly logger = new Logger(CalendarRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Single events overlapping the range, plus every series that starts
   * before it ends (expansion decides which of their occurrences land in
   * it). Three plain queries in parallel rather than one `or()` filter.
   */
  async listForRange(user: AuthenticatedUser, range: RangeBounds): Promise<CalendarEvent[]> {
    const client = this.supabaseService.forUser(user.token);
    const results = await Promise.all([
      client
        .from(TABLE)
        .select(COLUMNS)
        .eq('user_id', user.id)
        .is('rrule', null)
        .eq('all_day', false)
        .lt('starts_at', range.startsBefore)
        .gt('ends_at', range.endsAfter),
      client
        .from(TABLE)
        .select(COLUMNS)
        .eq('user_id', user.id)
        .is('rrule', null)
        .eq('all_day', true)
        .lt('starts_on', range.toDate)
        .gte('ends_on', range.fromDate),
      client.from(TABLE).select(COLUMNS).eq('user_id', user.id).not('rrule', 'is', null),
    ]);
    const rows: EventRow[] = [];
    for (const { data, error } of results) {
      if (error) {
        this.logger.error(`Failed to list calendar events: ${error.message}`);
        throw new InternalServerErrorException('Failed to list calendar events');
      }
      rows.push(...((data ?? []) as EventRow[]));
    }
    return rows
      .filter((row) =>
        row.rrule === null
          ? true
          : row.all_day
            ? (row.starts_on ?? '') < range.toDate
            : Date.parse(row.starts_at ?? '') < Date.parse(range.startsBefore),
      )
      .map((row) => this.toEvent(row));
  }

  async findById(user: AuthenticatedUser, id: string): Promise<CalendarEvent | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      this.logger.error(`Failed to read calendar event: ${error.message}`);
      throw new InternalServerErrorException('Failed to read calendar event');
    }
    return data ? this.toEvent(data as EventRow) : null;
  }

  async create(user: AuthenticatedUser, values: EventValues): Promise<CalendarEvent> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: user.id, ...toRow(values) })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error(`Failed to create calendar event: ${error?.message}`);
      throw new InternalServerErrorException('Failed to create calendar event');
    }
    return this.toEvent(data as EventRow);
  }

  /** Replaces the event (or the whole series). Null when no owned row matched. */
  async replace(
    user: AuthenticatedUser,
    id: string,
    values: EventValues,
    now: Date = new Date(),
  ): Promise<CalendarEvent | null> {
    return this.updateRow(user, id, toRow(values), now);
  }

  /** Sets a series' skipped occurrences. Null when no owned row matched. */
  async setExdates(
    user: AuthenticatedUser,
    id: string,
    exdates: string[],
    now: Date = new Date(),
  ): Promise<CalendarEvent | null> {
    return this.updateRow(user, id, { exdates }, now);
  }

  private async updateRow(
    user: AuthenticatedUser,
    id: string,
    changes: Record<string, unknown>,
    now: Date,
  ): Promise<CalendarEvent | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .update({ ...changes, updated_at: now.toISOString() })
      .eq('user_id', user.id)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      this.logger.error(`Failed to update calendar event: ${error.message}`);
      throw new InternalServerErrorException('Failed to update calendar event');
    }
    return data ? this.toEvent(data as EventRow) : null;
  }

  /** False when no owned row matched. */
  async delete(user: AuthenticatedUser, id: string): Promise<boolean> {
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
      this.logger.error(`Failed to delete calendar event: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete calendar event');
    }
    return data !== null;
  }

  /** Corrupt stored data is a 500, never a client-facing ZodError. */
  private toEvent(row: EventRow): CalendarEvent {
    const parsed = CalendarEventSchema.safeParse({
      id: row.id,
      title: row.title,
      location: row.location,
      note: row.note,
      rrule: row.rrule,
      exdates: row.exdates ?? [],
      timeZone: row.time_zone,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      ...(row.all_day
        ? { allDay: true, startsOn: row.starts_on, endsOn: row.ends_on }
        : {
            allDay: false,
            startsAt: row.starts_at && toIso(row.starts_at),
            endsAt: row.ends_at && toIso(row.ends_at),
          }),
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored calendar event "${row.id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored calendar event is invalid');
    }
    return parsed.data;
  }
}
