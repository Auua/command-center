import { describe, expect, it } from 'vitest';
import type { MoodCheckin } from '@command-center/contracts';
import { buildTrend, latestToday, moodLabel } from './trend';

/**
 * All fixtures are built from local-time Date components so the tests pass
 * in any timezone (CI runs UTC, dev machines don't).
 */
function atLocal(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

let counter = 0;
function checkin(overrides: Partial<MoodCheckin>): MoodCheckin {
  counter += 1;
  return {
    id: `6f2d38a0-9a1e-4a0e-8f2a-${String(counter).padStart(12, '0')}`,
    score: 3,
    tags: [],
    note: null,
    createdAt: atLocal(2026, 7, 12),
    ...overrides,
  };
}

// A fixed local "now": Sunday 2026-07-12, 15:00.
const NOW = new Date(2026, 6, 12, 15, 0);

describe('buildTrend', () => {
  it('returns one entry per local day, oldest first, ending today', () => {
    const trend = buildTrend([], NOW);

    expect(trend).toHaveLength(7);
    expect(trend[0]?.key).toBe('2026-07-06');
    expect(trend[6]?.key).toBe('2026-07-12');
    expect(trend.every((day) => day.average === null)).toBe(true);
  });

  it('averages multiple check-ins within the same local day', () => {
    const items = [
      checkin({ score: 2, createdAt: atLocal(2026, 7, 12, 9) }),
      checkin({ score: 5, createdAt: atLocal(2026, 7, 12, 14) }),
    ];

    const trend = buildTrend(items, NOW);
    expect(trend[6]?.average).toBe(3.5);
  });

  it('buckets check-ins into their own local days and leaves gaps null', () => {
    const items = [
      checkin({ score: 4, createdAt: atLocal(2026, 7, 10) }),
      checkin({ score: 2, createdAt: atLocal(2026, 7, 7) }),
    ];

    const trend = buildTrend(items, NOW);
    expect(trend.map((day) => day.average)).toEqual([null, 2, null, null, 4, null, null]);
  });

  it('ignores check-ins outside the window', () => {
    const items = [checkin({ score: 5, createdAt: atLocal(2026, 7, 1) })];

    const trend = buildTrend(items, NOW);
    expect(trend.every((day) => day.average === null)).toBe(true);
  });

  it('labels each day with a narrow weekday', () => {
    const trend = buildTrend([], NOW);
    // Weekday letters, not dates — exact letters depend on locale, so just
    // check shape.
    expect(trend.every((day) => day.label.length >= 1 && day.label.length <= 3)).toBe(true);
  });
});

describe('latestToday', () => {
  it("returns the newest of today's check-ins", () => {
    const morning = checkin({ score: 2, createdAt: atLocal(2026, 7, 12, 8) });
    const afternoon = checkin({ score: 4, createdAt: atLocal(2026, 7, 12, 14) });

    expect(latestToday([morning, afternoon], NOW)).toEqual(afternoon);
    expect(latestToday([afternoon, morning], NOW)).toEqual(afternoon);
  });

  it("ignores yesterday's check-ins", () => {
    const yesterday = checkin({ score: 5, createdAt: atLocal(2026, 7, 11, 23) });

    expect(latestToday([yesterday], NOW)).toBeNull();
  });

  it('returns null when nothing was logged', () => {
    expect(latestToday([], NOW)).toBeNull();
  });
});

describe('moodLabel', () => {
  it("maps scores to the mock's face labels", () => {
    expect(moodLabel(1)).toBe('Rough');
    expect(moodLabel(3)).toBe('Okay');
    expect(moodLabel(5)).toBe('Great');
  });

  it('returns an empty string for unknown scores', () => {
    expect(moodLabel(42)).toBe('');
  });
});
