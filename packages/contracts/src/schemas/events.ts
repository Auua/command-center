import { z } from 'zod';

/**
 * In-process domain events (ADR §4.1). Event keys and payload shapes live
 * here — not in the emitting module — so a listener in another module never
 * imports across the domain boundary (ADR-002, ADR-014's rule).
 */

/** Emitted by TasksModule when a task transitions to completed. */
export const TASK_COMPLETED_EVENT = 'task.completed';

export const TaskCompletedEventSchema = z.object({
  userId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string(),
  /** ISO datetime the completion was recorded at (server clock). */
  completedAt: z.string().datetime(),
});
export type TaskCompletedEvent = z.infer<typeof TaskCompletedEventSchema>;

/**
 * Emitted by LearningModule when the user acknowledges the word of the day
 * ("learned it") — the only WOTD streak source (ADR-011/014). `date` is the
 * UTC learning day the pin belonged to.
 */
export const WOTD_ACKNOWLEDGED_EVENT = 'wotd.acknowledged';

export const WotdAcknowledgedEventSchema = z.object({
  userId: z.string().min(1),
  /** Vault-relative note path. */
  itemId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** ISO datetime the acknowledge was recorded at (server clock). */
  acknowledgedAt: z.string().datetime(),
});
export type WotdAcknowledgedEvent = z.infer<typeof WotdAcknowledgedEventSchema>;
