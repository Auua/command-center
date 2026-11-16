import {
  CALENDAR_OCCURRENCES_MAX,
  daysBetween,
  type CalendarEvent,
  type CalendarOccurrence,
} from '@command-center/contracts';
import { DateTime } from 'luxon';
import { Frequency, RRule, type Options } from 'rrule';

/**
 * Recurrence expansion (ADR-018) — the calendar's one piece of real logic,
 * and pure.
 *
 * `rrule` computes in "floating" time: a Date whose UTC fields are read as
 * wall-clock fields. A timed series is expanded in the wall clock of its own
 * timezone (`timeZone`, captured when it was written) and each occurrence is
 * then placed as an instant in that zone — so "every Tuesday 09:00" stays
 * at 09:00 across a DST change instead of drifting by an hour. All-day
 * series are expanded as plain dates and never meet a timezone.
 */

const DAY_MS = 86_400_000;

/** More occurrences than one response may carry. */
export class TooManyOccurrencesError extends Error {
  constructor() {
    super(`More than ${CALENDAR_OCCURRENCES_MAX} occurrences in the range`);
    this.name = 'TooManyOccurrencesError';
  }
}

// ── Floating time ──────────────────────────────────────────────────────────

function toFloating(wall: DateTime): Date {
  return new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
  );
}

function fromFloating(floating: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone },
  );
}

const dateToFloating = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const floatingToDate = (floating: Date): string => floating.toISOString().slice(0, 10);
const addDays = (date: string, days: number): string =>
  floatingToDate(new Date(dateToFloating(date).getTime() + days * DAY_MS));

/** The key a timed occurrence is known by — also its `exdates` entry. */
export const instantKey = (value: string | Date): string => new Date(value).toISOString();

// ── Rules ──────────────────────────────────────────────────────────────────

function parseRule(rule: string): Partial<Options> {
  return RRule.parseString(rule);
}

/**
 * Why a submitted RRULE cannot be stored, or null when it can: it must
 * parse, carry a frequency no finer than hourly, and leave DTSTART/TZID to
 * the event (the event's own start is the series start).
 */
export function ruleProblem(rule: string): string | null {
  if (/DTSTART|TZID|EXDATE|RDATE|\n/i.test(rule)) {
    return 'Send only the RRULE part — the event’s start is the series start';
  }
  let options: Partial<Options>;
  try {
    options = parseRule(rule);
  } catch {
    return 'Unreadable recurrence rule';
  }
  if (options.freq === undefined || options.freq === null) return 'The rule needs a FREQ';
  if (options.freq === Frequency.MINUTELY || options.freq === Frequency.SECONDLY) {
    return 'Repeating more often than hourly is not supported';
  }
  return null;
}

function ruleFor(event: CalendarEvent): { rule: RRule; dtstart: Date } {
  const dtstart = event.allDay
    ? dateToFloating(event.startsOn)
    : toFloating(DateTime.fromISO(event.startsAt, { zone: event.timeZone }));
  return { rule: new RRule({ ...parseRule(event.rrule ?? ''), dtstart }), dtstart };
}

/** False when a series' rule never produces an occurrence (e.g. UNTIL before the start). */
export function hasOccurrences(event: CalendarEvent): boolean {
  if (!event.rrule) return true;
  const { rule, dtstart } = ruleFor(event);
  return rule.after(dtstart, true) !== null;
}

/** True when `key` is one of the series' occurrence starts (exdates aside). */
export function isOccurrence(event: CalendarEvent, key: string): boolean {
  if (!event.rrule) return false;
  const { rule } = ruleFor(event);
  let floating: Date;
  if (event.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    floating = dateToFloating(key);
  } else {
    const at = DateTime.fromISO(key, { zone: 'utc' });
    if (!at.isValid) return false;
    floating = toFloating(at.setZone(event.timeZone));
  }
  return rule
    .between(new Date(floating.getTime() - 1), new Date(floating.getTime() + 1), true)
    .some((date) => date.getTime() === floating.getTime());
}

// ── Expansion ──────────────────────────────────────────────────────────────

export interface ExpansionRange {
  /** YYYY-MM-DD, inclusive, in `zone`. */
  from: string;
  /** YYYY-MM-DD, exclusive, in `zone`. */
  to: string;
  /** The home timezone the range's days are counted in. */
  zone: string;
}

interface Placed {
  occurrence: CalendarOccurrence;
  sortKey: number;
}

/**
 * Every occurrence of `events` overlapping the range, chronological
 * (all-day before timed on a day). Throws TooManyOccurrencesError past
 * CALENDAR_OCCURRENCES_MAX.
 */
export function expandRange(
  events: readonly CalendarEvent[],
  range: ExpansionRange,
): CalendarOccurrence[] {
  const placed: Placed[] = [];
  const push = (item: Placed): void => {
    placed.push(item);
    if (placed.length > CALENDAR_OCCURRENCES_MAX) throw new TooManyOccurrencesError();
  };
  const rangeStart = DateTime.fromISO(range.from, { zone: range.zone }).startOf('day');
  const rangeEnd = DateTime.fromISO(range.to, { zone: range.zone }).startOf('day');
  const dayStart = (date: string): number =>
    DateTime.fromISO(date, { zone: range.zone }).startOf('day').toMillis();

  for (const event of events) {
    const base = {
      seriesId: event.id,
      isRecurring: event.rrule !== null,
      title: event.title,
      location: event.location,
      note: event.note,
    };
    const skipped = new Set(event.exdates);

    if (event.allDay) {
      const span = daysBetween(event.startsOn, event.endsOn);
      const emit = (startsOn: string): void => {
        const endsOn = addDays(startsOn, span);
        if (startsOn >= range.to || endsOn < range.from || skipped.has(startsOn)) return;
        push({
          occurrence: { ...base, occurrenceStart: startsOn, allDay: true, startsOn, endsOn },
          sortKey: dayStart(startsOn) - 1,
        });
      };
      if (!event.rrule) {
        emit(event.startsOn);
        continue;
      }
      const { rule } = ruleFor(event);
      const after = dateToFloating(addDays(range.from, -span));
      const before = dateToFloating(range.to);
      for (const date of between(rule, after, before)) emit(floatingToDate(date));
      continue;
    }

    const durationMs = Date.parse(event.endsAt) - Date.parse(event.startsAt);
    const emit = (start: DateTime): void => {
      const end = start.plus({ milliseconds: durationMs });
      const key = instantKey(start.toJSDate());
      if (start >= rangeEnd || end <= rangeStart || skipped.has(key)) return;
      push({
        occurrence: {
          ...base,
          occurrenceStart: key,
          allDay: false,
          startsAt: key,
          endsAt: instantKey(end.toJSDate()),
        },
        sortKey: start.toMillis(),
      });
    };
    if (!event.rrule) {
      emit(DateTime.fromISO(event.startsAt, { zone: 'utc' }));
      continue;
    }
    const { rule } = ruleFor(event);
    // The range in the series' own wall clock, widened by the duration (an
    // occurrence that began before the range may still overlap it) and a
    // day either side for offset differences; `emit` cuts it exactly.
    const after = new Date(
      toFloating(rangeStart.setZone(event.timeZone)).getTime() - durationMs - DAY_MS,
    );
    const before = new Date(toFloating(rangeEnd.setZone(event.timeZone)).getTime() + DAY_MS);
    for (const floating of between(rule, after, before)) {
      emit(fromFloating(floating, event.timeZone));
    }
  }

  return placed
    .sort((a, b) => a.sortKey - b.sortKey || a.occurrence.title.localeCompare(b.occurrence.title))
    .map((item) => item.occurrence);
}

/**
 * Candidates one `between` may produce before the rule is called runaway.
 * The window is a little wider than the range (duration + a day each side),
 * so the cap on what actually lands in the range is applied by `push`;
 * this only bounds the work (an hourly rule over 366 days is ~8 800).
 */
const CANDIDATES_MAX = 20_000;

function between(rule: RRule, after: Date, before: Date): Date[] {
  const dates = rule.between(after, before, true, (_date, index) => index < CANDIDATES_MAX);
  if (dates.length >= CANDIDATES_MAX) throw new TooManyOccurrencesError();
  return dates;
}
