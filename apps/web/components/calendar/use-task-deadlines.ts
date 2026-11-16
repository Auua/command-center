'use client';

import { useQuery } from '@tanstack/react-query';
import type { Task } from '@command-center/contracts';
import { fetchTasks } from '@/lib/tasks-api';

/**
 * The task-deadline overlay (ADR-018): open tasks due in [from, to), read
 * from the tasks widget's own `['tasks']` query — no calendar endpoint, no
 * projection table; the markers are read-only. Off → no request at all.
 */
export function useTaskDeadlines(enabled: boolean, from: string, to: string): Task[] {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, enabled });
  if (!enabled) return [];
  return (tasks.data?.items ?? []).filter(
    (task) =>
      task.completedAt === null &&
      task.deadline !== null &&
      task.deadline >= from &&
      task.deadline < to,
  );
}

export function tasksByDay(tasks: readonly Task[]): Map<string, Task[]> {
  const byDay = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.deadline) continue;
    byDay.set(task.deadline, [...(byDay.get(task.deadline) ?? []), task]);
  }
  return byDay;
}
