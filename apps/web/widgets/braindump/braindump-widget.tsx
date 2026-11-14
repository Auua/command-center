'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { z } from 'zod';
import {
  DismissButton,
  ErrorText,
  List,
  ListItem,
  PencilIcon,
  RetryIcon,
  Skeleton,
  WidgetBody,
  WidgetMessage,
} from '@command-center/ui';
import { createBraindumpNote, deleteBraindumpNote, fetchBraindumpNotes } from '@/lib/braindump-api';
import { t } from '@/lib/i18n';

export const braindumpSettingsSchema = z.object({});

export type BraindumpSettings = z.input<typeof braindumpSettingsSchema>;

const QUERY_KEY = ['braindump'];

/**
 * Casual note age, per the design mock: "20 minutes ago", "yesterday, 21:14",
 * falling back to "Jul 8, 09:14" for anything older.
 */
function formatTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });

  const time = then.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff === 0) {
    return t('time.hoursAgo', { count: Math.floor(minutes / 60) });
  }
  if (dayDiff === 1) return t('time.yesterdayAt', { time });
  const date = then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${date}, ${time}`;
}

/**
 * Braindump — quick, frictionless thought capture (first Mongo-backed
 * widget, ADR §9 Phase 1). Mirrors the design mock's card: a pill-shaped
 * capture input on top, then a flat list of notes (newest first) separated
 * by hairlines, each with a casual relative timestamp.
 */
export function BraindumpWidget(): ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const notesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchBraindumpNotes,
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: createBraindumpNote,
    onSuccess: () => {
      setDraft('');
      return invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBraindumpNote,
    onSuccess: invalidate,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = draft.trim();
    if (!content || createMutation.isPending) return;
    createMutation.mutate(content);
  }

  let body: ReactElement;
  if (notesQuery.isPending) {
    body = <Skeleton shapes={['row', 'row', 'row']} label={t('braindump.loading')} />;
  } else if (notesQuery.isError) {
    body = (
      <WidgetMessage
        tone="error"
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void notesQuery.refetch(),
        }}
      >
        {t('braindump.error.load')}
      </WidgetMessage>
    );
  } else if (notesQuery.data.items.length === 0) {
    body = <WidgetMessage>{t('braindump.empty')}</WidgetMessage>;
  } else {
    body = (
      <List className="cc-braindump-list">
        {notesQuery.data.items.map((note) => (
          <ListItem key={note.id} className="cc-braindump-item">
            <div className="cc-braindump-item-main">
              <p className="cc-braindump-item-content">{note.content}</p>
              <time className="cc-braindump-item-time" dateTime={note.createdAt}>
                {formatTimestamp(note.createdAt)}
              </time>
            </div>
            <DismissButton
              label={t('braindump.delete', { excerpt: note.content.slice(0, 40) })}
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(note.id)}
            />
          </ListItem>
        ))}
      </List>
    );
  }

  return (
    <WidgetBody className="cc-braindump">
      <form className="cc-braindump-form" onSubmit={handleSubmit}>
        <span className="cc-braindump-form-icon" aria-hidden="true">
          <PencilIcon />
        </span>
        <label className="cc-visually-hidden" htmlFor="cc-braindump-input">
          {t('braindump.label')}
        </label>
        <textarea
          id="cc-braindump-input"
          className="cc-braindump-input"
          placeholder={t('braindump.placeholder')}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter makes a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {/* Hidden submit keeps Enter-to-add reliable and discoverable to AT. */}
        <button
          type="submit"
          className="cc-visually-hidden"
          disabled={createMutation.isPending || draft.trim().length === 0}
        >
          {t('braindump.add')}
        </button>
      </form>
      {createMutation.isError && <ErrorText>{t('braindump.error.save')}</ErrorText>}
      {body}
    </WidgetBody>
  );
}
