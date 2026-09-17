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
