import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TASK_COMPLETED_EVENT, type TaskCompletedEvent } from '@command-center/contracts';
import { DispatchService } from '../scheduler/dispatch.service';

/**
 * The Phase-2 consumer of `task.completed` (the seam TasksModule left open,
 * ADR §4.1): matches the emitting user's enabled event automations and
 * dispatches inline through the shared claim → bell → push tail with
 * slot = the event timestamp (ADR-039 — "faster, not slower", no tick hop).
 *
 * TasksService emits with `emitAsync` and awaits it, so this handler runs to
 * completion inside the task-completion request — on a serverless host,
 * work after the response is not guaranteed to run (ADR-039 amendment,
 * 2026-09-17). Listener errors are logged, never rethrown: a broken reminder
 * must not fail the task-completion request that emitted the event.
 */
@Injectable()
export class TaskCompletedListener {
  private readonly logger = new Logger(TaskCompletedListener.name);

  constructor(private readonly dispatchService: DispatchService) {}

  @OnEvent(TASK_COMPLETED_EVENT)
  async handleTaskCompleted(event: TaskCompletedEvent): Promise<void> {
    try {
      await this.dispatchService.dispatchEventAutomations(
        event.userId,
        'task.completed',
        new Date(event.completedAt),
      );
    } catch (error) {
      this.logger.error(
        `Event dispatch for task.completed failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
