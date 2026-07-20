import { describe, expect, it } from 'vitest';
import { describeSchedule, formatWallTime, isoWeekdayShortNames } from './time-format';

describe('formatWallTime', () => {
  it('reads the wall time textually from an offset ISO string (stored-tz display)', () => {
    // 08:00 in the user's timezone must render as 08:00 regardless of the
    // browser timezone — the offset is NOT applied.
    expect(formatWallTime('2026-07-19T08:00:00+03:00', 'h23', 'en-US')).toBe('08:00');
  });

  it('formats plain HH:mm values', () => {
    expect(formatWallTime('21:30', 'h23', 'en-US')).toBe('21:30');
  });

  it('honors the h12 hour cycle', () => {
    expect(formatWallTime('13:05', 'h12', 'en-US')).toMatch(/1[:.]05/);
  });

  it('passes through unparseable values', () => {
    expect(formatWallTime('later', 'h23', 'en-US')).toBe('later');
  });
});

describe('isoWeekdayShortNames', () => {
  it('returns seven names, Monday-first', () => {
    const names = isoWeekdayShortNames('en-US');
    expect(names).toHaveLength(7);
    expect((names[0] ?? '').toLowerCase()).toContain('mon');
    expect((names[6] ?? '').toLowerCase()).toContain('sun');
  });
});

describe('describeSchedule', () => {
  it('summarizes daily schedules', () => {
    expect(describeSchedule({ type: 'daily', time: '12:00' }, 'h23', 'en-US')).toBe('12:00 daily');
  });

  it('names the weekdays preset', () => {
    expect(
      describeSchedule({ type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }, 'h23', 'en-US'),
    ).toBe('08:30 · weekdays');
  });

  it('names the weekends preset', () => {
    expect(describeSchedule({ type: 'weekly', time: '10:00', days: [6, 7] }, 'h23', 'en-US')).toBe(
      '10:00 · weekends',
    );
  });

  it('lists custom days by short name', () => {
    const summary = describeSchedule(
      { type: 'weekly', time: '10:00', days: [1, 4] },
      'h23',
      'en-US',
    );
    expect(summary).toContain('10:00');
    expect(summary.toLowerCase()).toContain('mon');
    expect(summary.toLowerCase()).toContain('thu');
  });

  it('summarizes intervals in minutes and hours', () => {
    expect(describeSchedule({ type: 'interval', everyMinutes: 30 }, 'h23', 'en-US')).toBe(
      'every 30 min',
    );
    expect(describeSchedule({ type: 'interval', everyMinutes: 120 }, 'h23', 'en-US')).toBe(
      'every 2 h',
    );
  });
});
