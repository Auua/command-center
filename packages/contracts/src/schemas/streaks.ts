import { z } from 'zod';

/**
 * Streaks (ADR-014): a read-only aggregation over per-day marks recorded
 * from domain events. Keys are the source widget ids; display names come
 * from the i18n catalog, never from the API.
 */
export const STREAK_KEYS = ['tasks', 'japanese-wotd', 'japanese-grammar'] as const;
export const StreakKeySchema = z.enum(STREAK_KEYS);
export type StreakKey = z.infer<typeof StreakKeySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const StreakSchema = z.object({
  streakKey: z.string().min(1),
  /** 0 when the last active day is older than yesterday (read-time rollover). */
  currentLen: z.number().int().min(0),
  bestLen: z.number().int().min(0),
  lastActiveDate: isoDate.nullable(),
  activeToday: z.boolean(),
  /** Oldest first, in the user's home timezone with the 03:00 grace. */
  last7: z.array(z.boolean()).length(7),
});
export type Streak = z.infer<typeof StreakSchema>;

/** GET /streaks */
export const StreaksResponseSchema = z.object({
  timezone: z.string().min(1),
  streaks: z.array(StreakSchema),
});
export type StreaksResponse = z.infer<typeof StreaksResponseSchema>;
