/**
 * Emitted when a task transitions to completed (ARD §4.1). AutomationModule
 * (Phase 2) listens for this to evaluate "after finishing a task" smart
 * reminders; nothing consumes it yet, but the seam is load-bearing.
 */
export const TASK_COMPLETED_EVENT = "task.completed";

export interface TaskCompletedEvent {
  userId: string;
  taskId: string;
  title: string;
  completedAt: string;
}
