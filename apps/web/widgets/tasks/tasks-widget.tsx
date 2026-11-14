'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { z } from 'zod';
import type { Task } from '@command-center/contracts';
import {
  CheckIcon,
  Chip,
  DismissButton,
  ErrorText,
  List,
  ListItem,
  RetryIcon,
  Skeleton,
  WidgetBody,
  WidgetMessage,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { createTask, deleteTask, fetchTasks, updateTask } from '@/lib/tasks-api';
import { formatDueLabel } from './due-label';
import { parseQuickAdd } from './quick-add';

export const tasksSettingsSchema = z.object({});

export type TasksSettings = z.input<typeof tasksSettingsSchema>;

const QUERY_KEY = ['tasks'];

const PRIORITY_TONES = { 1: 'coral', 2: 'amber', 3: 'sky' } as const;

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
    <ListItem className={done ? 'cc-tasks-item done' : 'cc-tasks-item'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        className="cc-tasks-cbx"
        aria-label={
          done
            ? t('tasks.markIncomplete', { title: task.title })
            : t('tasks.markComplete', { title: task.title })
        }
        disabled={disabled}
        onClick={() => onToggle(task)}
      >
        <CheckIcon size={11} stroke={3.5} />
      </button>
      <span className="cc-tasks-name">
        {task.title}
        {task.tags.map((tag) => (
          <span key={tag} className="cc-tasks-tag">
            #{tag}
          </span>
        ))}
      </span>
      {task.priority !== null && <Chip tone={PRIORITY_TONES[task.priority]}>P{task.priority}</Chip>}
      {done ? (
        <time className="cc-tasks-due" dateTime={task.completedAt ?? undefined}>
          {t('tasks.done')}
        </time>
      ) : due ? (
        <time
          className={due.isOverdue ? 'cc-tasks-due cc-tasks-due-overdue' : 'cc-tasks-due'}
          dateTime={task.deadline ?? undefined}
        >
          {due.label}
        </time>
      ) : null}
      <DismissButton
        label={t('tasks.delete', { title: task.title })}
        disabled={disabled}
        onClick={() => onDelete(task)}
      />
    </ListItem>
  );
}

/**
 * Tasks — the todo widget (ADR Phase 1, mock's "Today's tasks" card). Lists
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

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

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

  let body: ReactElement;
  if (tasksQuery.isPending) {
    body = <Skeleton shapes={['row', 'row', 'row']} label={t('tasks.loading')} />;
  } else if (tasksQuery.isError) {
    body = (
      <WidgetMessage
        tone="error"
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void tasksQuery.refetch(),
        }}
      >
        {t('tasks.error.load')}
      </WidgetMessage>
    );
  } else if (tasksQuery.data.items.length === 0) {
    body = <WidgetMessage>{t('tasks.empty')}</WidgetMessage>;
  } else {
    body = (
      <List className="cc-tasks-list">
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
      </List>
    );
  }

  return (
    <WidgetBody className="cc-tasks">
      <form className="cc-tasks-quick-add" onSubmit={handleSubmit}>
        <span className="cc-tasks-quick-add-plus" aria-hidden="true">
          +
        </span>
        <label className="cc-visually-hidden" htmlFor="cc-tasks-quick-add">
          {t('tasks.quickAdd.label')}
        </label>
        <input
          id="cc-tasks-quick-add"
          className="cc-tasks-quick-add-input"
          type="text"
          placeholder={t('tasks.quickAdd.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={createMutation.isPending}
        />
        {/* Hidden submit keeps Enter-to-add reliable and discoverable to AT. */}
        <button type="submit" className="cc-visually-hidden">
          {t('tasks.add')}
        </button>
      </form>
      {createMutation.isError && <ErrorText>{t('tasks.error.save')}</ErrorText>}
      {(toggleMutation.isError || deleteMutation.isError) && (
        <ErrorText>{t('tasks.error.update')}</ErrorText>
      )}
      {body}
    </WidgetBody>
  );
}
