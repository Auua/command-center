import type { CalendarEvent } from '@command-center/contracts';
import {
  expandRange,
  hasOccurrences,
  isOccurrence,
  ruleProblem,
  TooManyOccurrencesError,
} from './expansion';

const HELSINKI = 'Europe/Helsinki';
let seq = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const stamps = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

function timed(
  startsAt: string,
  endsAt: string,
  rrule: string | null = null,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: id(),
    title: 'Timed',
    location: null,
    note: null,
    rrule,
    exdates: [],
    timeZone: HELSINKI,
    ...stamps,
    allDay: false,
    startsAt,
    endsAt,
    ...extra,
  } as CalendarEvent;
}

function allDay(
  startsOn: string,
  endsOn: string,
  rrule: string | null = null,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: id(),
    title: 'All day',
    location: null,
    note: null,
    rrule,
    exdates: [],
    timeZone: HELSINKI,
    ...stamps,
    allDay: true,
    startsOn,
    endsOn,
    ...extra,
  } as CalendarEvent;
}

const starts = (events: CalendarEvent[], from: string, to: string, zone = HELSINKI): string[] =>
  expandRange(events, { from, to, zone }).map((o) => o.occurrenceStart);

describe('expandRange — DST in Europe/Helsinki', () => {
  it('keeps a daily 09:00 at 09:00 across spring-forward (UTC moves an hour)', () => {
    // 2026-03-29 03:00 EET → 04:00 EEST.
    const daily = timed('2026-03-27T07:00:00.000Z', '2026-03-27T08:00:00.000Z', 'FREQ=DAILY');
    expect(starts([daily], '2026-03-27', '2026-04-01')).toEqual([
      '2026-03-27T07:00:00.000Z',
      '2026-03-28T07:00:00.000Z',
      '2026-03-29T06:00:00.000Z',
      '2026-03-30T06:00:00.000Z',
      '2026-03-31T06:00:00.000Z',
    ]);
  });

  it('keeps a daily 09:00 at 09:00 across fall-back', () => {
    // 2026-10-25 04:00 EEST → 03:00 EET.
    const daily = timed('2026-10-23T06:00:00.000Z', '2026-10-23T07:00:00.000Z', 'FREQ=DAILY');
    expect(starts([daily], '2026-10-23', '2026-10-27')).toEqual([
      '2026-10-23T06:00:00.000Z',
      '2026-10-24T06:00:00.000Z',
      '2026-10-25T07:00:00.000Z',
      '2026-10-26T07:00:00.000Z',
    ]);
  });

  it('keeps each occurrence as long as the first', () => {
    const daily = timed('2026-03-28T07:00:00.000Z', '2026-03-28T08:30:00.000Z', 'FREQ=DAILY');
    const [, sunday] = expandRange([daily], {
      from: '2026-03-28',
      to: '2026-03-30',
      zone: HELSINKI,
    });
    expect(sunday).toMatchObject({
      startsAt: '2026-03-29T06:00:00.000Z',
      endsAt: '2026-03-29T07:30:00.000Z',
    });
  });
});

describe('expandRange — termination and week start', () => {
  it('counts COUNT from the series start, not the range start', () => {
    const three = timed(
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
      'FREQ=DAILY;COUNT=3',
    );
    expect(starts([three], '2026-11-02', '2026-11-10')).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
    ]);
  });

  it('ends at UNTIL, read in the series’ wall clock', () => {
    const until = timed(
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
      'FREQ=DAILY;UNTIL=20261103T235959Z',
    );
    expect(starts([until], '2026-11-01', '2026-11-10')).toHaveLength(3);
  });

  it('honours WKST (RFC 5545’s own example)', () => {
    const rule = (wkst: string): CalendarEvent =>
      timed(
        '1997-08-05T09:00:00.000Z',
        '1997-08-05T10:00:00.000Z',
        `FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=${wkst}`,
        { timeZone: 'UTC' },
      );
    const days = (wkst: string): string[] =>
      starts([rule(wkst)], '1997-08-01', '1997-09-01', 'UTC').map((s) => s.slice(0, 10));
    expect(days('MO')).toEqual(['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24']);
    expect(days('SU')).toEqual(['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31']);
  });
});

describe('expandRange — exceptions, overlap and order', () => {
  it('skips the exdates', () => {
    const weekly = timed('2026-11-03T08:00:00.000Z', '2026-11-03T09:00:00.000Z', 'FREQ=WEEKLY', {
      exdates: ['2026-11-10T08:00:00.000Z'],
    });
    expect(starts([weekly], '2026-11-01', '2026-11-20')).toEqual([
      '2026-11-03T08:00:00.000Z',
      '2026-11-17T08:00:00.000Z',
    ]);
  });

  it('includes an occurrence that began before the range and runs into it', () => {
    const late = timed('2026-11-01T21:00:00.000Z', '2026-11-01T23:30:00.000Z', 'FREQ=DAILY');
    // 23:00–01:30 Helsinki: the one starting on the 4th runs into the 5th.
    expect(starts([late], '2026-11-05', '2026-11-06')).toEqual([
      '2026-11-04T21:00:00.000Z',
      '2026-11-05T21:00:00.000Z',
    ]);
  });

  it('counts the range’s days in the home zone, not the series’ zone', () => {
    // 09:00 Helsinki = 07:00Z; a Tokyo day runs 15:00Z–15:00Z.
    const daily = timed('2026-11-01T07:00:00.000Z', '2026-11-01T08:00:00.000Z', 'FREQ=DAILY');
    expect(starts([daily], '2026-11-20', '2026-11-21', 'Asia/Tokyo')).toEqual([
      '2026-11-20T07:00:00.000Z',
    ]);
  });

  it('places all-day events as dates, inclusive, multi-day included', () => {
    const trip = allDay('2026-11-27', '2026-11-29');
    expect(starts([trip], '2026-11-29', '2026-11-30')).toEqual(['2026-11-27']);
    expect(starts([trip], '2026-11-30', '2026-12-01')).toEqual([]);
    const birthday = allDay('2000-07-14', '2000-07-14', 'FREQ=YEARLY');
    expect(
      expandRange([birthday], { from: '2026-07-01', to: '2026-08-01', zone: 'Asia/Tokyo' }),
    ).toEqual([
      expect.objectContaining({
        occurrenceStart: '2026-07-14',
        startsOn: '2026-07-14',
        endsOn: '2026-07-14',
      }),
    ]);
  });

  it('skips an all-day exdate by its date', () => {
    const weekly = allDay('2026-11-02', '2026-11-02', 'FREQ=WEEKLY', { exdates: ['2026-11-09'] });
    expect(starts([weekly], '2026-11-01', '2026-11-20')).toEqual(['2026-11-02', '2026-11-16']);
  });

  it('lists chronologically, all-day first on a day', () => {
    const morning = timed('2026-11-20T06:00:00.000Z', '2026-11-20T07:00:00.000Z', null, {
      title: 'Run',
    });
    const holiday = allDay('2026-11-20', '2026-11-20', null, { title: 'Day off' });
    const earlier = timed('2026-11-19T10:00:00.000Z', '2026-11-19T11:00:00.000Z', null, {
      title: 'Call',
    });
    expect(
      expandRange([morning, holiday, earlier], {
        from: '2026-11-19',
        to: '2026-11-21',
        zone: HELSINKI,
      }).map((o) => o.title),
    ).toEqual(['Call', 'Day off', 'Run']);
  });

  it('marks series occurrences as recurring and single events as not', () => {
    const [single] = expandRange([allDay('2026-11-20', '2026-11-20')], {
      from: '2026-11-20',
      to: '2026-11-21',
      zone: HELSINKI,
    });
    expect(single?.isRecurring).toBe(false);
  });

  it('refuses more than 500 occurrences in one range', () => {
    const hourly = timed('2026-11-01T00:00:00.000Z', '2026-11-01T00:30:00.000Z', 'FREQ=HOURLY');
    expect(() =>
      expandRange([hourly], { from: '2026-11-01', to: '2026-12-01', zone: HELSINKI }),
    ).toThrow(TooManyOccurrencesError);
    expect(starts([hourly], '2026-11-02', '2026-11-03')).toHaveLength(24);
  });
});

describe('rules', () => {
  it('refuses what cannot be expanded, or is finer than hourly', () => {
    expect(ruleProblem('FREQ=WEEKLY;BYDAY=TU')).toBeNull();
    expect(ruleProblem('FREQ=HOURLY;INTERVAL=2')).toBeNull();
    expect(ruleProblem('FREQ=MINUTELY')).not.toBeNull();
    expect(ruleProblem('FREQ=SECONDLY')).not.toBeNull();
    expect(ruleProblem('BYDAY=TU')).not.toBeNull();
    expect(ruleProblem('FREQ=NOPE')).not.toBeNull();
    expect(ruleProblem('DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY')).not.toBeNull();
    expect(ruleProblem('FREQ=DAILY;TZID=Europe/Helsinki')).not.toBeNull();
  });

  it('knows a rule that never occurs', () => {
    expect(
      hasOccurrences(
        timed(
          '2026-11-10T08:00:00.000Z',
          '2026-11-10T09:00:00.000Z',
          'FREQ=DAILY;UNTIL=20261101T000000Z',
        ),
      ),
    ).toBe(false);
    expect(hasOccurrences(timed('2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z'))).toBe(
      true,
    );
  });

  it('recognises a real occurrence start, and nothing else', () => {
    const weekly = timed('2026-03-24T07:00:00.000Z', '2026-03-24T08:00:00.000Z', 'FREQ=WEEKLY');
    // After spring-forward the same 09:00 is 06:00Z.
    expect(isOccurrence(weekly, '2026-03-31T06:00:00.000Z')).toBe(true);
    expect(isOccurrence(weekly, '2026-03-31T07:00:00.000Z')).toBe(false);
    expect(isOccurrence(weekly, 'garbage')).toBe(false);
    const yearly = allDay('2000-07-14', '2000-07-14', 'FREQ=YEARLY');
    expect(isOccurrence(yearly, '2026-07-14')).toBe(true);
    expect(isOccurrence(yearly, '2026-07-15')).toBe(false);
    expect(
      isOccurrence(
        timed('2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z'),
        '2026-11-10T08:00:00.000Z',
      ),
    ).toBe(false);
  });
});
