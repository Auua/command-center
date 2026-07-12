import { z } from 'zod';

/**
 * Mood check-in — a 1 (rough) to 5 (great) score with optional tags and note
 * (ARD §4.4: relational, lives in Postgres `mood_checkins`, owned by
 * MoodModule). Check-ins are immutable: changing your mind means logging a
 * new one (trends average per day), undoing means deleting.
 */
export const MOOD_SCORES = [1, 2, 3, 4, 5] as const;

export const MoodScoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type MoodScore = z.infer<typeof MoodScoreSchema>;

export const MoodCheckinSchema = z.object({
  id: z.string().uuid(),
  score: MoodScoreSchema,
  tags: z.array(z.string().min(1)),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type MoodCheckin = z.infer<typeof MoodCheckinSchema>;

export const MoodCheckinListResponseSchema = z.object({
  items: z.array(MoodCheckinSchema),
});
export type MoodCheckinListResponse = z.infer<typeof MoodCheckinListResponseSchema>;

const MoodTagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(20)
  .transform((tags) => [...new Set(tags)]);

/**
 * Write-path schema rejects unknown top-level fields here in the contract
 * (ARD §5.2 reject-unknown-fields), matching the tasks convention.
 */
export const CreateMoodCheckinRequestSchema = z
  .object({
    score: MoodScoreSchema,
    tags: MoodTagsSchema.default([]),
    note: z.string().trim().min(1).max(1000).nullable().default(null),
  })
  .strict();
export type CreateMoodCheckinRequest = z.infer<typeof CreateMoodCheckinRequestSchema>;

/**
 * `?days=` query window for listing check-ins. The API windows by timestamp
 * only — bucketing into calendar days happens client-side, in the user's
 * own timezone (the server can't know it).
 */
export const MoodWindowDaysSchema = z.coerce.number().int().min(1).max(90).default(7);
