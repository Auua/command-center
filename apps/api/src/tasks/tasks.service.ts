import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TASK_COMPLETED_EVENT,
  type CreateTaskRequest,
  type Task,
  type TaskCompletedEvent,
  type TaskListResponse,
  type UpdateTaskRequest,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TasksRepository, type TaskPatch } from './tasks.repository';

/**
 * Business rules for tasks (controllers stay thin — ADR §4.1). A malformed
 * or foreign task id is deliberately indistinguishable from a missing one:
 * both 404, nothing leaks about other users' data.
 *
 * Completion time is set here from the clock, never taken from the client,
 * and completing a task emits `task.completed` on the in-process event bus
 * (ADR §4.1 — AutomationModule's smart reminders hook in there). The emit is
 * awaited (`emitAsync`) so listener work finishes inside the request: on a
 * serverless host, work after the response is not guaranteed to run
 * (ADR-039). Listeners catch their own errors, so awaiting never fails the
 * request.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async listTasks(user: AuthenticatedUser): Promise<TaskListResponse> {
    const items = await this.tasksRepository.listForUser(user);
    return { items };
  }

  createTask(user: AuthenticatedUser, request: CreateTaskRequest): Promise<Task> {
    return this.tasksRepository.createForUser(user, request);
  }

  async updateTask(user: AuthenticatedUser, id: string, request: UpdateTaskRequest): Promise<Task> {
    const { completed, ...fields } = request;
    const patch: TaskPatch = { ...fields };
    if (completed !== undefined) {
      patch.completed_at = completed ? new Date().toISOString() : null;
    }

    const task = await this.tasksRepository.updateForUser(user, id, patch);
    if (!task) {
      throw new NotFoundException(`Task "${id}" not found`);
    }

    if (completed === true && task.completedAt !== null) {
      const event: TaskCompletedEvent = {
        userId: user.id,
        taskId: task.id,
        title: task.title,
        completedAt: task.completedAt,
      };
      await this.eventEmitter.emitAsync(TASK_COMPLETED_EVENT, event);
    }
    return task;
  }

  async deleteTask(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.tasksRepository.deleteForUser(user, id);
    if (!deleted) {
      throw new NotFoundException(`Task "${id}" not found`);
    }
  }
}
