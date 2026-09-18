import {
  applyDay,
  effectiveCurrent,
  last7,
  last7Range,
  streakDateOf,
  streakToday,
} from './streak-math';

describe('streakDateOf', () => {
  it('uses the home-timezone day with the 03:00 grace window', () => {
    // 00:30 Helsinki on the 19th (21:30Z on the 18th) still counts for the 18th.
    expect(streakDateOf('2026-09-18T21:30:00.000Z', 'Europe/Helsinki')).toBe('2026-09-18');
    // 03:30 Helsinki on the 19th counts for the 19th.
    expect(streakDateOf('2026-09-19T00:30:00.000Z', 'Europe/Helsinki')).toBe('2026-09-19');
    // Same instant is still the 18th's day in UTC terms after the grace.
    expect(streakDateOf('2026-09-19T00:30:00.000Z', 'UTC')).toBe('2026-09-18');
  });

  it('falls back to UTC now on an invalid instant', () => {
    expect(streakDateOf('not-a-date', 'Europe/Helsinki')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(streakToday('Europe/Helsinki')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('applyDay', () => {
  it('starts a streak at 1', () => {
    expect(applyDay(null, '2026-09-18')).toEqual({
      currentLen: 1,
      bestLen: 1,
      lastActiveDate: '2026-09-18',
    });
  });

  it('extends on the next day and keeps best', () => {
    const row = { currentLen: 3, bestLen: 5, lastActiveDate: '2026-09-17' };
    expect(applyDay(row, '2026-09-18')).toEqual({
      currentLen: 4,
      bestLen: 5,
      lastActiveDate: '2026-09-18',
    });
  });

  it('is a no-op for the same day or an older day (no backfill)', () => {
    const row = { currentLen: 3, bestLen: 5, lastActiveDate: '2026-09-17' };
    expect(applyDay(row, '2026-09-17')).toBeNull();
    expect(applyDay(row, '2026-09-10')).toBeNull();
  });

  it('restarts at 1 after a gap and raises best when passed', () => {
    const row = { currentLen: 6, bestLen: 6, lastActiveDate: '2026-09-10' };
    expect(applyDay(row, '2026-09-18')).toEqual({
      currentLen: 1,
      bestLen: 6,
      lastActiveDate: '2026-09-18',
    });
    expect(
      applyDay({ currentLen: 6, bestLen: 6, lastActiveDate: '2026-09-17' }, '2026-09-18'),
    ).toEqual({
      currentLen: 7,
      bestLen: 7,
      lastActiveDate: '2026-09-18',
    });
  });
});

describe('effectiveCurrent / last7', () => {
  it('reads as alive today or yesterday, otherwise 0', () => {
    expect(
      effectiveCurrent({ currentLen: 4, bestLen: 4, lastActiveDate: '2026-09-18' }, '2026-09-18'),
    ).toBe(4);
    expect(
      effectiveCurrent({ currentLen: 4, bestLen: 4, lastActiveDate: '2026-09-17' }, '2026-09-18'),
    ).toBe(4);
    expect(
      effectiveCurrent({ currentLen: 4, bestLen: 4, lastActiveDate: '2026-09-16' }, '2026-09-18'),
    ).toBe(0);
    expect(
      effectiveCurrent({ currentLen: 0, bestLen: 0, lastActiveDate: null }, '2026-09-18'),
    ).toBe(0);
  });

  it('maps active days onto the last seven, oldest first', () => {
    const days = new Set(['2026-09-12', '2026-09-17', '2026-09-18']);
    expect(last7(days, '2026-09-18')).toEqual([true, false, false, false, false, true, true]);
    expect(last7Range('2026-09-18')).toEqual({ from: '2026-09-12', to: '2026-09-18' });
  });
});
