import { z } from 'zod';

/**
 * Tick staleness on the public health probe (NFR-10, ADR-039): the external
 * pinger is the automation clock, so /health exposes how recently a tick
 * landed — UptimeRobot keyword-monitors for `"tick":"ok"`.
 *
 * - ok      — last tick within the staleness threshold (5 min)
 * - stale   — scheduler_state exists but the last tick is old (pinger down?)
 * - never   — no tick has ever run (fresh deploy)
 * - unknown — scheduler state unreadable (DB unreachable)
 * - unconfigured — the ADR-039 env group is unset; ticks are rejected
 */
export const TickStatusSchema = z.enum(['ok', 'stale', 'never', 'unknown', 'unconfigured']);
export type TickStatus = z.infer<typeof TickStatusSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.string(),
  tick: TickStatusSchema.optional(),
  lastTickAt: z.string().nullable().optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
