import { DateTime } from 'luxon';

/**
 * Pure streak arithmetic (ADR-014). The streak day is the home-timezone
 * calendar day ending at 03:00 local: activity between 00:00 and 03:00
 * credits the day that just ended. Rollover is computed on read — a row
 * whose last active day is older than yesterday reads as 0 (ADR-005/039
 * deferred the worker that would have zeroed it).
 */

export const GRACE_HOURS = 3;

export interface StreakRow {
  currentLen: number;
  bestLen: number;
  lastActiveDate: string | null;
}

/** ISO date of the streak day an instant belongs to, in `timezone`. */
export function streakDateOf(instantIso: string, timezone: string): string {
  const local = DateTime.fromISO(instantIso, { zone: 'utc' }).setZone(timezone);
  return (local.isValid ? local : DateTime.utc()).minus({ hours: GRACE_HOURS }).toISODate() ?? '';
}

/** Today's streak day for a timezone (same grace rule). */
export function streakToday(timezone: string, now: Date = new Date()): string {
  return streakDateOf(now.toISOString(), timezone);
}

function nextDay(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days: 1 }).toISODate() ?? isoDate;
}

/**
 * The row after recording `localDate`, or null when nothing changes (same
 * day again, or a day older than the last active one — no backfill).
 */
export function applyDay(row: StreakRow | null, localDate: string): StreakRow | null {
  if (!row || row.lastActiveDate === null) {
    return { currentLen: 1, bestLen: Math.max(1, row?.bestLen ?? 0), lastActiveDate: localDate };
  }
  if (localDate <= row.lastActiveDate) return null;
  const current = localDate === nextDay(row.lastActiveDate) ? row.currentLen + 1 : 1;
  return {
    currentLen: current,
    bestLen: Math.max(row.bestLen, current),
    lastActiveDate: localDate,
  };
}

/** Read-time rollover: the streak is alive only if active today or yesterday. */
export function effectiveCurrent(row: StreakRow, today: string): number {
  if (row.lastActiveDate === null) return 0;
  const alive = row.lastActiveDate === today || nextDay(row.lastActiveDate) === today;
  return alive ? row.currentLen : 0;
}

/** Seven booleans, oldest first, ending with `today`. */
export function last7(activeDays: ReadonlySet<string>, today: string): boolean[] {
  const end = DateTime.fromISO(today, { zone: 'utc' });
  return Array.from({ length: 7 }, (_, index) => {
    const day = end.minus({ days: 6 - index }).toISODate() ?? '';
    return activeDays.has(day);
  });
}

/** The 7 dates last7 covers (for the repository's range query). */
export function last7Range(today: string): { from: string; to: string } {
  const end = DateTime.fromISO(today, { zone: 'utc' });
  return { from: end.minus({ days: 6 }).toISODate() ?? today, to: today };
}
