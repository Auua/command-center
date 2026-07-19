import { compileSchedule } from './schedule-compiler';
import { expandOccurrences } from './schedule-evaluator';

/**
 * The DST cases pin cron-parser v5 behavior *empirically* — these tests are
 * the widget/tick agreement contract (plan S2). Europe/Helsinki 2026:
 *
 * - Spring forward, Sun 2026-03-29: at 03:00 EET (+02:00) clocks jump to
 *   04:00 EEST (+03:00) — local times 03:00–03:59 don't exist that day.
 * - Fall back, Sun 2026-10-25: at 04:00 EEST clocks return to 03:00 EET —
 *   local times 03:00–03:59 happen twice.
 *
 * (The doubled hour in Helsinki is 03:00–03:59 local — 02:30 never repeats
 * in this zone; that's the CET transition. The double-fire behavior lives on
 * the interval case below, as two distinct UTC slots.)
 */
const TZ = 'Europe/Helsinki';

function iso(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

function window(startIso: string, endIso: string): { start: Date; end: Date } {
  return { start: new Date(startIso), end: new Date(endIso) };
}

describe('expandOccurrences — window semantics', () => {
  it('treats the window as (start, end]: excludes start, includes end', () => {
    const hourly = compileSchedule({ type: 'interval', everyMinutes: 60 });
    expect(
      iso(expandOccurrences(hourly, 'UTC', window('2026-07-19T12:00:00Z', '2026-07-19T14:00:00Z'))),
    ).toEqual(['2026-07-19T13:00:00.000Z', '2026-07-19T14:00:00.000Z']);
  });

  it('returns [] for an empty or inverted window', () => {
    const daily = compileSchedule({ type: 'daily', time: '12:00' });
    expect(
      expandOccurrences(daily, 'UTC', window('2026-07-19T12:00:00Z', '2026-07-19T12:00:00Z')),
    ).toEqual([]);
    expect(
      expandOccurrences(daily, 'UTC', window('2026-07-19T12:00:00Z', '2026-07-19T11:00:00Z')),
    ).toEqual([]);
  });

  it('evaluates wall-clock times in the given timezone', () => {
    // 12:00 Helsinki summer (EEST, +03:00) = 09:00 UTC.
    const daily = compileSchedule({ type: 'daily', time: '12:00' });
    expect(
      iso(expandOccurrences(daily, TZ, window('2026-07-19T00:00:00Z', '2026-07-20T00:00:00Z'))),
    ).toEqual(['2026-07-19T09:00:00.000Z']);
  });

  it('maps weekly ISO day 7 to Sunday', () => {
    // 2026-07-19 is a Sunday; 10:00 EEST = 07:00 UTC.
    const weekly = compileSchedule({ type: 'weekly', time: '10:00', days: [7] });
    expect(
      iso(expandOccurrences(weekly, TZ, window('2026-07-13T00:00:00Z', '2026-07-20T00:00:00Z'))),
    ).toEqual(['2026-07-19T07:00:00.000Z']);
  });

  it('expands weekday schedules across a whole week', () => {
    const weekdays = compileSchedule({ type: 'weekly', time: '21:30', days: [1, 2, 3, 4, 5] });
    const slots = expandOccurrences(
      weekdays,
      TZ,
      window('2026-07-12T21:00:00Z', '2026-07-19T21:00:00Z'),
    );
    // Mon 13th .. Fri 17th at 21:30 EEST (18:30 UTC).
    expect(iso(slots)).toEqual([
      '2026-07-13T18:30:00.000Z',
      '2026-07-14T18:30:00.000Z',
      '2026-07-15T18:30:00.000Z',
      '2026-07-16T18:30:00.000Z',
      '2026-07-17T18:30:00.000Z',
    ]);
  });
});

describe('expandOccurrences — DST spring forward (Helsinki, 2026-03-29)', () => {
  it('fires a daily time inside the skipped hour once, shifted +1h wall clock', () => {
    // 03:30 local does not exist on 2026-03-29. cron-parser fires the
    // occurrence once at 01:30 UTC = 04:30 EEST — shifted, not lost.
    const daily = compileSchedule({ type: 'daily', time: '03:30' });
    expect(
      iso(expandOccurrences(daily, TZ, window('2026-03-28T20:00:00Z', '2026-03-29T20:00:00Z'))),
    ).toEqual(['2026-03-29T01:30:00.000Z']);
  });

  it('keeps daily times outside the gap unshifted on the transition day', () => {
    // 02:30 EET (+02:00) = 00:30 UTC — before the jump, unaffected.
    const daily = compileSchedule({ type: 'daily', time: '02:30' });
    expect(
      iso(expandOccurrences(daily, TZ, window('2026-03-28T20:00:00Z', '2026-03-29T20:00:00Z'))),
    ).toEqual(['2026-03-29T00:30:00.000Z']);
  });

  it('keeps interval schedules on their real-time period across the gap', () => {
    // Every 30 real minutes; the local wall clock jumps 03:00 -> 04:00 at
    // 01:00 UTC but UTC slots stay evenly spaced.
    const halfHourly = compileSchedule({ type: 'interval', everyMinutes: 30 });
    expect(
      iso(
        expandOccurrences(halfHourly, TZ, window('2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z')),
      ),
    ).toEqual([
      '2026-03-29T00:30:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T01:30:00.000Z',
      '2026-03-29T02:00:00.000Z',
    ]);
  });

  it('surviving both transition days, a daily schedule fires exactly once per day', () => {
    const daily = compileSchedule({ type: 'daily', time: '03:30' });
    const springWeek = expandOccurrences(
      daily,
      TZ,
      window('2026-03-26T20:00:00Z', '2026-03-31T20:00:00Z'),
    );
    expect(springWeek).toHaveLength(5);
  });
});

describe('expandOccurrences — DST fall back (Helsinki, 2026-10-25)', () => {
  it('fires a daily time inside the repeated hour once (first pass, EEST)', () => {
    // 03:30 local happens at 00:30 UTC (EEST) and again at 01:30 UTC (EET);
    // a *daily* schedule fires once, on the first pass — never twice.
    const daily = compileSchedule({ type: 'daily', time: '03:30' });
    expect(
      iso(expandOccurrences(daily, TZ, window('2026-10-24T20:00:00Z', '2026-10-25T20:00:00Z'))),
    ).toEqual(['2026-10-25T00:30:00.000Z']);
  });

  it('fires interval slots for both passes of the repeated hour — distinct UTC slots', () => {
    // Every 30 real minutes across the fall-back window: the doubled local
    // times (03:00, 03:30) each occur twice as *distinct UTC instants*, so
    // UNIQUE (automation_id, slot) treats them as two legitimate fires.
    const halfHourly = compileSchedule({ type: 'interval', everyMinutes: 30 });
    const slots = expandOccurrences(
      halfHourly,
      TZ,
      window('2026-10-24T23:00:00Z', '2026-10-25T02:00:00Z'),
    );
    expect(iso(slots)).toEqual([
      '2026-10-24T23:30:00.000Z', // 02:30 EEST
      '2026-10-25T00:00:00.000Z', // 03:00 EEST (first pass)
      '2026-10-25T00:30:00.000Z', // 03:30 EEST (first pass)
      '2026-10-25T01:00:00.000Z', // 03:00 EET (second pass — distinct slot)
      '2026-10-25T01:30:00.000Z', // 03:30 EET (second pass — distinct slot)
      '2026-10-25T02:00:00.000Z', // 04:00 EET
    ]);
    // No duplicate UTC instants: dedupe stays structural, not accidental.
    expect(new Set(iso(slots)).size).toBe(slots.length);
  });

  it('keeps a daily schedule at once-per-day across the fall-back week', () => {
    const daily = compileSchedule({ type: 'daily', time: '03:30' });
    const week = expandOccurrences(
      daily,
      TZ,
      window('2026-10-22T20:00:00Z', '2026-10-27T20:00:00Z'),
    );
    expect(week).toHaveLength(5);
  });
});

describe('expandOccurrences — catch-up shapes', () => {
  it('expands every missed slot of a dense schedule over a long window', () => {
    const fiveMin = compileSchedule({ type: 'interval', everyMinutes: 5 });
    const slots = expandOccurrences(
      fiveMin,
      'UTC',
      window('2026-07-19T12:00:00Z', '2026-07-19T13:00:00Z'),
    );
    expect(slots).toHaveLength(12); // 12:05 .. 13:00
  });

  it('caps runaway expansion at the hard occurrence bound', () => {
    const everyMinute = '* * * * *';
    const slots = expandOccurrences(
      everyMinute,
      'UTC',
      window('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'),
    );
    expect(slots).toHaveLength(1000);
  });
});
