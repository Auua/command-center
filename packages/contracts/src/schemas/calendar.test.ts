import { describe, expect, it } from 'vitest';
import {
  CalendarEventWriteSchema,
  CalendarOccurrenceSchema,
  CalendarRangeQuerySchema,
  daysBetween,
} from './calendar';

describe('CalendarEventWriteSchema', () => {
  it('accepts a timed event and normalises empty optionals to null', () => {
    expect(
      CalendarEventWriteSchema.parse({
        allDay: false,
        title: '  Dentist ',
        startsAt: '2026-11-20T08:00:00.000Z',
        endsAt: '2026-11-20T09:00:00.000Z',
        location: '',
        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=FR',
      }),
    ).toEqual({
      allDay: false,
      title: 'Dentist',
      startsAt: '2026-11-20T08:00:00.000Z',
      endsAt: '2026-11-20T09:00:00.000Z',
      location: null,
      note: null,
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
    });
  });

  it('accepts an all-day event as dates, inclusive', () => {
    const event = CalendarEventWriteSchema.parse({
      allDay: true,
      title: 'Birthday',
      startsOn: '2026-07-14',
      endsOn: '2026-07-14',
    });
    expect(event).toMatchObject({ allDay: true, startsOn: '2026-07-14', endsOn: '2026-07-14' });
  });

  it('never mixes the two representations, and refuses unknown fields', () => {
    expect(
      CalendarEventWriteSchema.safeParse({
        allDay: true,
        title: 'x',
        startsOn: '2026-07-14',
        endsOn: '2026-07-14',
        startsAt: '2026-07-14T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      CalendarEventWriteSchema.safeParse({
        allDay: false,
        title: 'x',
        startsOn: '2026-07-14',
        endsOn: '2026-07-14',
      }).success,
    ).toBe(false);
    expect(
      CalendarEventWriteSchema.safeParse({
        allDay: false,
        title: 'x',
        startsAt: '2026-11-20T08:00:00Z',
        endsAt: '2026-11-20T09:00:00Z',
        userId: 'someone',
      }).success,
    ).toBe(false);
  });

  it('refuses an event that ends before it starts, or has no title', () => {
    const timed = { allDay: false, title: 'x', startsAt: '2026-11-20T09:00:00Z' };
    expect(
      CalendarEventWriteSchema.safeParse({ ...timed, endsAt: '2026-11-20T09:00:00Z' }).success,
    ).toBe(false);
    expect(
      CalendarEventWriteSchema.safeParse({
        allDay: true,
        title: 'x',
        startsOn: '2026-07-14',
        endsOn: '2026-07-13',
      }).success,
    ).toBe(false);
    expect(
      CalendarEventWriteSchema.safeParse({ ...timed, title: '  ', endsAt: '2026-11-20T10:00:00Z' })
        .success,
    ).toBe(false);
  });
});

describe('CalendarRangeQuerySchema', () => {
  it('takes a date range of 1–366 days, `to` exclusive', () => {
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-02' }).success,
    ).toBe(true);
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success,
    ).toBe(true);
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-03' }).success,
    ).toBe(false);
    expect(CalendarRangeQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(false);
  });

  it('counts days across a DST change without drifting', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('CalendarOccurrenceSchema', () => {
  it('reads a timed and an all-day occurrence', () => {
    const base = {
      seriesId: '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e',
      isRecurring: false,
      title: 'x',
      location: null,
      note: null,
    };
    expect(
      CalendarOccurrenceSchema.safeParse({
        ...base,
        occurrenceStart: '2026-11-20T08:00:00.000Z',
        allDay: false,
        startsAt: '2026-11-20T08:00:00.000Z',
        endsAt: '2026-11-20T09:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CalendarOccurrenceSchema.safeParse({
        ...base,
        occurrenceStart: '2026-07-14',
        allDay: true,
        startsOn: '2026-07-14',
        endsOn: '2026-07-14',
      }).success,
    ).toBe(true);
  });
});
