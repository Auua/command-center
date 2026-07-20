import { z } from 'zod';

/**
 * Profile — per-user settings (ADR §4.4 `user_profiles`; owned by
 * ProfileModule). Phase 2 needs exactly one field: the home IANA timezone
 * that the schedule evaluator and today endpoint expand cron expressions in
 * (Q1). The client auto-captures the browser timezone on first authed load
 * when no profile exists (plan D4).
 */

/** True iff `Intl` accepts the value as a time zone — no tz-database dep. */
export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidIanaTimeZone, { message: 'timezone must be a valid IANA time zone' });

export const ProfileSchema = z.object({
  timezone: TimezoneSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

/** PUT /profile — upsert (write-path strict, ADR §5.2). */
export const UpdateProfileRequestSchema = z
  .object({
    timezone: TimezoneSchema,
  })
  .strict();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
