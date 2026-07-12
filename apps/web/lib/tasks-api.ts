import {
  TaskListResponseSchema,
  TaskSchema,
  type CreateTaskRequest,
  type Task,
  type TaskListResponse,
  type UpdateTaskRequest,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Client for /api/v1/tasks (TasksModule). The API returns tasks pre-sorted
 * (completed at the top like the design mock, then open tasks by priority,
 * then deadline) — render in order.
 */

export async function fetchTasks(): Promise<TaskListResponse> {
  const response = await apiFetch('/api/v1/tasks');
  return TaskListResponseSchema.parse(await response.json());
}

export async function createTask(input: CreateTaskRequest): Promise<Task> {
  const response = await apiFetch('/api/v1/tasks', {
    method: 'POST',
    body: input,
  });
  return TaskSchema.parse(await response.json());
}

export async function updateTask(id: string, patch: UpdateTaskRequest): Promise<Task> {
  const response = await apiFetch(`/api/v1/tasks/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  return TaskSchema.parse(await response.json());
}

export async function deleteTask(id: string): Promise<void> {
  await apiFetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
}
