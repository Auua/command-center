import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CalendarEvent,
  CalendarEventWriteParsed,
  CalendarRangeQuery,
  CalendarRangeResponse,
} from '@command-center/contracts';
import { DateTime } from 'luxon';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileService } from '../profile/profile.service';
import { CalendarRepository } from './calendar.repository';
import {
  expandRange,
  hasOccurrences,
  instantKey,
  isOccurrence,
  ruleProblem,
  TooManyOccurrencesError,
} from './expansion';

/** A series keeps its skipped occurrences only while they can still mean the same slots. */
function sameSlots(before: CalendarEvent, after: CalendarEventWriteParsed): boolean {
  if (before.rrule !== after.rrule) return false;
  if (before.allDay && after.allDay) return before.startsOn === after.startsOn;
  if (!before.allDay && !after.allDay) {
    return instantKey(before.startsAt) === instantKey(after.startsAt);
  }
  return false;
}

/**
 * Business rules for the calendar (ADR-018; the controller stays thin).
 * Reads return expanded occurrences in the home timezone; writes refuse a
 * rule the expander cannot expand, or one that never occurs. A malformed or
 * foreign id is indistinguishable from a missing one: both 404.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly events: CalendarRepository,
    private readonly profile: ProfileService,
  ) {}

  async range(user: AuthenticatedUser, query: CalendarRangeQuery): Promise<CalendarRangeResponse> {
    const zone = await this.profile.getTimezone(user);
    const start = DateTime.fromISO(query.from, { zone }).startOf('day');
    const end = DateTime.fromISO(query.to, { zone }).startOf('day');
    const rows = await this.events.listForRange(user, {
      startsBefore: end.toUTC().toISO() ?? '',
      endsAfter: start.toUTC().toISO() ?? '',
      fromDate: query.from,
      toDate: query.to,
    });
    try {
      return {
        timeZone: zone,
        from: query.from,
        to: query.to,
        occurrences: expandRange(rows, { from: query.from, to: query.to, zone }),
      };
    } catch (error) {
      if (error instanceof TooManyOccurrencesError) {
        throw new BadRequestException(`${error.message} — narrow the range`);
      }
      throw error;
    }
  }

  async get(user: AuthenticatedUser, id: string): Promise<CalendarEvent> {
    const event = await this.events.findById(user, id);
    if (!event) throw new NotFoundException(`Calendar event "${id}" not found`);
    return event;
  }

  async create(user: AuthenticatedUser, write: CalendarEventWriteParsed): Promise<CalendarEvent> {
    const timeZone = await this.profile.getTimezone(user);
    this.assertExpandable(write, timeZone);
    return this.events.create(user, { event: write, timeZone, exdates: [] });
  }

  /**
   * Replaces the event, or the whole series. The series repeats in the
   * home timezone it was last written in (the dialog edits times there);
   * its skipped occurrences survive only an edit that keeps its rule and
   * start, since any other change moves the slots they name.
   */
  async replace(
    user: AuthenticatedUser,
    id: string,
    write: CalendarEventWriteParsed,
  ): Promise<CalendarEvent> {
    const current = await this.get(user, id);
    const timeZone = await this.profile.getTimezone(user);
    this.assertExpandable(write, timeZone);
    const exdates =
      sameSlots(current, write) && timeZone === current.timeZone ? current.exdates : [];
    const updated = await this.events.replace(user, id, { event: write, timeZone, exdates });
    if (!updated) throw new NotFoundException(`Calendar event "${id}" not found`);
    return updated;
  }

  async delete(user: AuthenticatedUser, id: string): Promise<void> {
    if (!(await this.events.delete(user, id))) {
      throw new NotFoundException(`Calendar event "${id}" not found`);
    }
  }

  /** "Delete this occurrence": the series skips it from now on. */
  async deleteOccurrence(
    user: AuthenticatedUser,
    id: string,
    occurrenceStart: string,
  ): Promise<CalendarEvent> {
    const event = await this.get(user, id);
    if (!event.rrule) {
      throw new BadRequestException('Not a recurring event — delete the event itself');
    }
    const key = event.allDay ? occurrenceStart : safeInstantKey(occurrenceStart);
    if (!key || !isOccurrence(event, key)) {
      throw new NotFoundException(`"${occurrenceStart}" is not an occurrence of this series`);
    }
    if (event.exdates.includes(key)) return event;
    const updated = await this.events.setExdates(user, id, [...event.exdates, key]);
    if (!updated) throw new NotFoundException(`Calendar event "${id}" not found`);
    return updated;
  }

  private assertExpandable(write: CalendarEventWriteParsed, timeZone: string): void {
    if (!write.rrule) return;
    const problem = ruleProblem(write.rrule);
    if (problem) throw new BadRequestException(problem);
    const probe = {
      ...write,
      id: '00000000-0000-4000-8000-000000000000',
      exdates: [],
      timeZone,
      createdAt: '',
      updatedAt: '',
    } as CalendarEvent;
    if (!hasOccurrences(probe)) {
      throw new BadRequestException('The recurrence never occurs (it ends before it starts)');
    }
  }
}

function safeInstantKey(value: string): string | null {
  return Number.isNaN(Date.parse(value)) ? null : instantKey(value);
}
