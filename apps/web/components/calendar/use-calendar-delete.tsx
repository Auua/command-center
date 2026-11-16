'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { CalendarOccurrence } from '@command-center/contracts';
import { deleteCalendarEvent, deleteCalendarOccurrence } from '@/lib/calendar-api';
import { t } from '@/lib/i18n';

export type DeleteScope = 'occurrence' | 'series';

/** How long a deletion can be undone (paused while Undo has focus or hover). */
export const CALENDAR_UNDO_MS = 5000;

interface Pending {
  occurrence: CalendarOccurrence;
  scope: DeleteScope;
  /** `undoable` while the toast shows; `committing` while the request runs. */
  phase: 'undoable' | 'committing';
}

type Announce = (kind: 'polite' | 'alert', message: string) => void;

export interface CalendarDelete {
  /** True for an occurrence a pending deletion hides. */
  isHidden: (occurrence: CalendarOccurrence) => boolean;
  /** Hide now, delete when the undo window closes. */
  remove: (occurrence: CalendarOccurrence, scope: DeleteScope) => void;
  /** The Undo toast, or null. */
  toast: ReactElement | null;
}

function send(pending: Pending): Promise<void> {
  const { occurrence, scope } = pending;
  return scope === 'series'
    ? deleteCalendarEvent(occurrence.seriesId)
    : deleteCalendarOccurrence(occurrence.seriesId, occurrence.occurrenceStart);
}

/**
 * Delete with undo (ADR-018, the shared undo pattern of ADR-008): the event
 * disappears at once, an Undo toast is announced and focused, and the
 * DELETE goes out only when the 5 s window closes — sooner when another
 * deletion starts or the view unmounts. A failed DELETE brings the event
 * back with an alert naming it, never silently.
 */
export function useCalendarDelete(announce: Announce): CalendarDelete {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const remaining = useRef(CALENDAR_UNDO_MS);
  const undoButton = useRef<HTMLButtonElement>(null);

  const update = (next: Pending | null): void => {
    pendingRef.current = next;
    setPending(next);
  };

  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const commit = useCallback(async (): Promise<void> => {
    const current = pendingRef.current;
    if (!current || current.phase !== 'undoable') return;
    clearTimer();
    const committing: Pending = { ...current, phase: 'committing' };
    update(committing);
    try {
      await send(committing);
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    } catch {
      announce('alert', t('calendar.undo.failed', { title: committing.occurrence.title }));
    } finally {
      if (pendingRef.current === committing) update(null);
    }
  }, [announce, queryClient]);

  const start = useCallback(
    (ms: number): void => {
      clearTimer();
      deadline.current = Date.now() + ms;
      timer.current = setTimeout(() => void commit(), ms);
    },
    [commit],
  );

  const remove = useCallback(
    (occurrence: CalendarOccurrence, scope: DeleteScope): void => {
      // One undo at a time: an earlier deletion is sent now.
      if (pendingRef.current?.phase === 'undoable') void commit();
      update({ occurrence, scope, phase: 'undoable' });
      remaining.current = CALENDAR_UNDO_MS;
      start(CALENDAR_UNDO_MS);
      announce('polite', t('calendar.undo.deleted', { title: occurrence.title }));
      // The row that held focus is gone: Undo takes it.
      requestAnimationFrame(() => undoButton.current?.focus());
    },
    [announce, commit, start],
  );

  const undo = (): void => {
    clearTimer();
    update(null);
  };
  const pause = (): void => {
    if (!timer.current) return;
    remaining.current = Math.max(0, deadline.current - Date.now());
    clearTimer();
  };
  const resume = (): void => {
    if (pendingRef.current?.phase === 'undoable' && !timer.current) start(remaining.current);
  };

  // Leaving the view sends a pending deletion rather than dropping it.
  useEffect(
    () => (): void => {
      clearTimer();
      const current = pendingRef.current;
      if (current?.phase === 'undoable') void send(current).catch(() => undefined);
    },
    [],
  );

  const isHidden = useCallback(
    (occurrence: CalendarOccurrence): boolean => {
      if (!pending || pending.occurrence.seriesId !== occurrence.seriesId) return false;
      return (
        pending.scope === 'series' ||
        pending.occurrence.occurrenceStart === occurrence.occurrenceStart
      );
    },
    [pending],
  );

  const toast =
    pending?.phase === 'undoable' ? (
      <div
        className="cc-calendar-toast"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
      >
        <span>{t('calendar.undo.deleted', { title: pending.occurrence.title })}</span>
        <button ref={undoButton} type="button" className="cc-btn cc-btn-sm" onClick={undo}>
          {t('calendar.undo')}
        </button>
      </div>
    ) : null;

  return { isHidden, remove, toast };
}
