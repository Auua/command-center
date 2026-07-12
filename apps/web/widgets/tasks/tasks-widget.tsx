'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { z } from 'zod';
import type { Task } from '@command-center/contracts';
import { createTask, deleteTask, fetchTasks, updateTask } from '@/lib/tasks-api';
import { formatDueLabel } from './due-label';
import { parseQuickAdd } from './quick-add';

export const tasksSettingsSchema = z.object({});

export type TasksSettings = z.input<typeof tasksSettingsSchema>;

const QUERY_KEY = ['tasks'];

const PRIORITY_LABELS: Record<1 | 2 | 3, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
};

function CheckIcon(): ReactElement {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  disabled,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  disabled: boolean;
}): ReactElement {
  const done = task.completedAt !== null;
  const due = task.deadline ? formatDueLabel(task.deadline, new Date()) : null;

  return (
    <li className={done ? 'cc-tasks-item done' : 'cc-tasks-item'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        className="cc-tasks-cbx"
        aria-label={done ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`}
        disabled={disabled}
        onClick={() => onToggle(task)}
      >
        <CheckIcon />
      </button>
      <span className="cc-tasks-name">
        {task.title}
        {task.tags.map((tag) => (
          <span key={tag} className="cc-tasks-tag">
            #{tag}
          </span>
        ))}
      </span>
      {task.priority !== null && (
        <span className={`cc-tasks-pill cc-tasks-pill-p${task.priority}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
      )}
      {done ? (
        <time className="cc-tasks-due" dateTime={task.completedAt ?? undefined}>
          done
        </time>
      ) : due ? (
        <time
          className={due.isOverdue ? 'cc-tasks-due cc-tasks-due-overdue' : 'cc-tasks-due'}
          dateTime={task.deadline ?? undefined}
        >
          {due.label}
        </time>
      ) : null}
      <button
        type="button"
        className="cc-tasks-delete"
        aria-label={`Delete task: ${task.title}`}
        disabled={disabled}
        onClick={() => onDelete(task)}
      >
        ×
      </button>
    </li>
  );
}

/**
 * Tasks — the todo widget (ARD Phase 1, mock's "Today's tasks" card). Lists
 * tasks in API order (completed at the top, then open by priority/deadline,
 * per the mock), toggles completion, and quick-adds with the
 * "pay rent friday p1" syntax (see quick-add.ts).
 */
export function TasksWidget(): ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const tasksQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchTasks,
  });

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      setDraft('');
      return invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      updateTask(id, { completed }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: invalidate,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (createMutation.isPending) return;
    const parsed = parseQuickAdd(draft, new Date());
    if (!parsed.title) return;
    createMutation.mutate(parsed);
  }

  return (
    <div className="cc-tasks">
      <form className="cc-tasks-quick-add" onSubmit={handleSubmit}>
        <span className="cc-tasks-quick-add-plus" aria-hidden="true">
          +
        </span>
        <label className="cc-visually-hidden" htmlFor="cc-tasks-quick-add">
          Quick add task — try &ldquo;pay rent friday p1&rdquo;
        </label>
        <input
          id="cc-tasks-quick-add"
          className="cc-tasks-quick-add-input"
          type="text"
          placeholder='Quick add — try "pay rent friday p1"'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={createMutation.isPending}
        />
        {/* Hidden submit keeps Enter-to-add reliable and discoverable to AT. */}
        <button type="submit" className="cc-visually-hidden">
          Add task
        </button>
      </form>
      {createMutation.isError && (
        <p className="cc-tasks-error" role="alert">
          Couldn&rsquo;t save that task — try again.
        </p>
      )}
      {(toggleMutation.isError || deleteMutation.isError) && (
        <p className="cc-tasks-error" role="alert">
          Couldn&rsquo;t update that task — try again.
        </p>
      )}

      {tasksQuery.isPending ? (
        <p className="cc-widget-placeholder" role="status">
          Loading tasks…
        </p>
      ) : tasksQuery.isError ? (
        <p className="cc-tasks-error" role="alert">
          Couldn&rsquo;t load tasks.
        </p>
      ) : tasksQuery.data.items.length === 0 ? (
        <p className="cc-widget-placeholder">Nothing on the list. Add your first task below.</p>
      ) : (
        <ul className="cc-tasks-list">
          {tasksQuery.data.items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              disabled={toggleMutation.isPending || deleteMutation.isPending}
              onToggle={(target) =>
                toggleMutation.mutate({
                  id: target.id,
                  completed: target.completedAt === null,
                })
              }
              onDelete={(target) => deleteMutation.mutate(target.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
