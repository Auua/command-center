import type { CalendarOccurrence } from '@command-center/contracts';

/**
 * Calendar date arithmetic (ADR-018) — pure, `Intl`-only. Dates are
 * YYYY-MM-DD strings; timed events are ISO instants placed in the **home**
 * timezone the API reports. Day maths runs on UTC-midnight Dates so a DST
 * change never adds or loses a day.
 */

const DAY_MS = 86_400_000;
const LOCALE = 'en-GB';

const atUtcMidnight = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const isoDateOf = (value: Date): string => value.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return isoDateOf(new Date(atUtcMidnight(date).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((atUtcMidnight(to).getTime() - atUtcMidnight(from).getTime()) / DAY_MS);
}

export function addMonths(date: string, months: number): string {
  const d = atUtcMidnight(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return isoDateOf(target);
}

/** 0 = Sunday … 6 = Saturday, like `Date.getDay`. */
export function weekdayOf(date: string): number {
  return atUtcMidnight(date).getUTCDay();
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function startOfWeek(date: string, weekStartsOn: number): string {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

/** The weeks shown for `date`'s month: whole weeks from the week of the 1st. */
export function monthGridDays(date: string, weekStartsOn: number): string[][] {
  const first = startOfMonth(date);
  const nextMonth = addMonths(first, 1);
  const weeks: string[][] = [];
  for (let day = startOfWeek(first, weekStartsOn); day < nextMonth; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

// ── Time zones ─────────────────────────────────────────────────────────────

interface WallClock {
  date: string;
  time: string;
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let format = partsFormat.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormat.set(zone, format);
  }
  return format;
}

function wallParts(instant: Date, zone: string): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** The date and HH:MM an instant shows on a wall clock in `zone`. */
export function wallClockOf(iso: string, zone: string): WallClock {
  const p = wallParts(new Date(iso), zone);
  const pad = (n: number | undefined): string => String(n ?? 0).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Today's date in `zone`. */
export function todayIn(zone: string, now: Date = new Date()): string {
  return wallClockOf(now.toISOString(), zone).date;
}

function offsetMs(instant: number, zone: string): number {
  const p = wallParts(new Date(instant), zone);
  const asUtc = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock date and HH:MM in `zone` names. A time that a
 * spring-forward skips lands an hour later, the way clocks do.
 */
export function instantOf(date: string, time: string, zone: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const wall = atUtcMidnight(date).getTime() + (hour * 60 + minute) * 60_000;
  let guess = wall - offsetMs(wall, zone);
  const corrected = wall - offsetMs(guess, zone);
  if (corrected !== guess) guess = corrected;
  return new Date(guess).toISOString();
}

// ── Occurrences on days ────────────────────────────────────────────────────

/**
 * The home-zone days an occurrence touches: all-day events their inclusive
 * dates, timed events every day from start to end (an end at exactly
 * midnight does not spill into the next day).
 */
export function daysOf(occurrence: CalendarOccurrence, zone: string): string[] {
  let first: string;
  let last: string;
  if (occurrence.allDay) {
    first = occurrence.startsOn;
    last = occurrence.endsOn;
  } else {
    first = wallClockOf(occurrence.startsAt, zone).date;
    const end = new Date(Date.parse(occurrence.endsAt) - 1).toISOString();
    last = wallClockOf(end, zone).date;
    if (last < first) last = first;
  }
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Occurrences grouped by the days they touch, keeping their order. */
export function groupByDay(
  occurrences: readonly CalendarOccurrence[],
  zone: string,
): Map<string, CalendarOccurrence[]> {
  const byDay = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of occurrences) {
    for (const day of daysOf(occurrence, zone)) {
      const list = byDay.get(day) ?? [];
      list.push(occurrence);
      byDay.set(day, list);
    }
  }
  return byDay;
}

// ── Formatting (NFR-12: Intl only, no English date literals) ───────────────

const utcFormat = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' });

/** "Tuesday 14 July" (the year when it isn't `currentYear`). */
export function formatDay(date: string, currentYear?: number): string {
  const sameYear = currentYear === undefined || Number(date.slice(0, 4)) === currentYear;
  return utcFormat({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(atUtcMidnight(date));
}

/** "Tue 14 Jul". */
export function formatShortDay(date: string): string {
  return utcFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(
    atUtcMidnight(date),
  );
}

/** "July 2026". */
export function formatMonth(date: string): string {
  return utcFormat({ month: 'long', year: 'numeric' }).format(atUtcMidnight(date));
}

/** Localised weekday names from `weekStartsOn`, short and long. */
export function weekdayNames(weekStartsOn: number): { short: string; long: string }[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays('2023-01-01', (weekStartsOn + i) % 7);
    return {
      short: utcFormat({ weekday: 'short' }).format(atUtcMidnight(date)),
      long: utcFormat({ weekday: 'long' }).format(atUtcMidnight(date)),
    };
  });
}

/** "09:30" for an instant in `zone`. */
export function formatTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The browser's own timezone — to say when times are shown in another one. */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
