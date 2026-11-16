import { describe, expect, it } from 'vitest';
import type { CalendarOccurrence } from '@command-center/contracts';
import {
  addDays,
  addMonths,
  daysOf,
  formatDay,
  formatTime,
  groupByDay,
  instantOf,
  monthGridDays,
  startOfWeek,
  todayIn,
  wallClockOf,
  weekdayNames,
} from './calendar-dates';

const HELSINKI = 'Europe/Helsinki';
const base = {
  seriesId: '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e',
  isRecurring: false,
  title: 'x',
  location: null,
  note: null,
};
const timed = (startsAt: string, endsAt: string): CalendarOccurrence => ({
  ...base,
  occurrenceStart: startsAt,
  allDay: false,
  startsAt,
  endsAt,
});

describe('day arithmetic', () => {
  it('adds days and months without DST drift or month overflow', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('finds the week start for Monday- and Sunday-first weeks', () => {
    // 2026-11-19 is a Thursday.
    expect(startOfWeek('2026-11-19', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-19', 0)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-16', 1)).toBe('2026-11-16');
  });

  it('lays a month out in whole weeks', () => {
    const weeks = monthGridDays('2026-11-19', 1);
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks.at(-1)?.at(-1)).toBe('2026-12-06');
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('names weekdays from the chosen week start', () => {
    expect(weekdayNames(1).map((d) => d.short)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(weekdayNames(0)[0]?.long).toBe('Sunday');
  });
});

describe('time zones', () => {
  it('reads an instant on the home wall clock', () => {
    expect(wallClockOf('2026-11-20T07:00:00.000Z', HELSINKI)).toEqual({
      date: '2026-11-20',
      time: '09:00',
    });
    expect(wallClockOf('2026-11-20T22:30:00.000Z', HELSINKI).date).toBe('2026-11-21');
    expect(todayIn('Asia/Tokyo', new Date('2026-11-20T16:00:00.000Z'))).toBe('2026-11-21');
  });

  it('turns a wall-clock time into the right instant on both sides of DST', () => {
    expect(instantOf('2026-03-28', '09:00', HELSINKI)).toBe('2026-03-28T07:00:00.000Z');
    expect(instantOf('2026-03-29', '09:00', HELSINKI)).toBe('2026-03-29T06:00:00.000Z');
    expect(instantOf('2026-10-25', '09:00', HELSINKI)).toBe('2026-10-25T07:00:00.000Z');
    expect(instantOf('2026-11-20', '00:00', 'UTC')).toBe('2026-11-20T00:00:00.000Z');
  });

  it('moves a time the spring-forward skips an hour on', () => {
    // 03:30 does not exist in Helsinki on 2026-03-29.
    expect(wallClockOf(instantOf('2026-03-29', '03:30', HELSINKI), HELSINKI).time).toBe('04:30');
  });

  it('formats dates and times with Intl', () => {
    expect(formatDay('2026-07-14', 2026)).toBe('Tuesday 14 July');
    expect(formatDay('2027-07-14', 2026)).toBe('Wednesday, 14 July 2027');
    expect(formatTime('2026-11-20T07:05:00.000Z', HELSINKI)).toBe('09:05');
  });
});

describe('occurrences on days', () => {
  it('spreads a timed event over the days it touches, but not past a midnight end', () => {
    expect(daysOf(timed('2026-11-20T20:00:00.000Z', '2026-11-20T23:00:00.000Z'), HELSINKI)).toEqual(
      ['2026-11-20', '2026-11-21'],
    );
    expect(daysOf(timed('2026-11-20T20:00:00.000Z', '2026-11-20T22:00:00.000Z'), HELSINKI)).toEqual(
      ['2026-11-20'],
    );
  });

  it('places all-day events on their own dates, whatever the zone', () => {
    const trip: CalendarOccurrence = {
      ...base,
      occurrenceStart: '2026-11-27',
      allDay: true,
      startsOn: '2026-11-27',
      endsOn: '2026-11-29',
    };
    expect(daysOf(trip, 'Pacific/Auckland')).toEqual(['2026-11-27', '2026-11-28', '2026-11-29']);
    expect([...groupByDay([trip], HELSINKI).keys()]).toEqual([
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
  });
});
