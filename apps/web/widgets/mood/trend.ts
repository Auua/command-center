import type { MoodCheckin, MoodScore } from '@command-center/contracts';

/**
 * Pure helpers behind the mood widget: face metadata, local-day bucketing,
 * and the 7-day trend series. All calendar math is deliberately done in the
 * browser's local timezone — "today" means the user's today, not UTC's.
 */

export const MOOD_FACES: readonly {
  score: MoodScore;
  emoji: string;
  label: string;
}[] = [
  { score: 1, emoji: '😞', label: 'Rough' },
  { score: 2, emoji: '😕', label: 'Low' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '🙂', label: 'Good' },
  { score: 5, emoji: '😄', label: 'Great' },
];

export function moodLabel(score: number): string {
  return MOOD_FACES.find((face) => face.score === score)?.label ?? '';
}

/** Local-timezone calendar day key, e.g. "2026-07-12". */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface TrendDay {
  /** Local-day key, e.g. "2026-07-12". */
  key: string;
  /** Narrow weekday label for the axis, e.g. "S", "M". */
  label: string;
  /** Average score for the day, or null when nothing was logged. */
  average: number | null;
}

/**
 * The last `days` local calendar days ending today, each with the average
 * of that day's check-ins (multiple check-ins per day are by design —
 * morning and afternoon reminders both log).
 */
export function buildTrend(items: MoodCheckin[], now: Date = new Date(), days = 7): TrendDay[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const item of items) {
    const key = dayKey(new Date(item.createdAt));
    const bucket = sums.get(key) ?? { total: 0, count: 0 };
    bucket.total += item.score;
    bucket.count += 1;
    sums.set(key, bucket);
  }

  const trend: TrendDay[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const key = dayKey(date);
    const bucket = sums.get(key);
    trend.push({
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      average: bucket ? bucket.total / bucket.count : null,
    });
  }
  return trend;
}

/** The newest check-in logged today (local time), or null. */
export function latestToday(items: MoodCheckin[], now: Date = new Date()): MoodCheckin | null {
  const today = dayKey(now);
  let latest: MoodCheckin | null = null;
  for (const item of items) {
    if (dayKey(new Date(item.createdAt)) !== today) continue;
    if (!latest || Date.parse(item.createdAt) > Date.parse(latest.createdAt)) {
      latest = item;
    }
  }
  return latest;
}
