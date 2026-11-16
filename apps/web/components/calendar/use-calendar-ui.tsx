'use client';

import { useCallback, useRef, useState, type ReactElement } from 'react';
import type { CalendarOccurrence } from '@command-center/contracts';
import { EventDialog, type EventDialogTarget } from './event-dialog';
import { useCalendarDelete } from './use-calendar-delete';

type Announce = (kind: 'polite' | 'alert', message: string) => void;

export interface CalendarUi {
  openCreate: (defaults: { date: string; time?: string; title?: string }) => void;
  openEdit: (occurrence: CalendarOccurrence) => void;
  /** Occurrences a pending (undoable) deletion hides. */
  isHidden: (occurrence: CalendarOccurrence) => boolean;
  /** The dialog and the Undo toast — render once. */
  ui: ReactElement;
}

/**
 * What the card and the `/calendar` page share: the event dialog, delete
 * with undo, and focus going back to whatever opened the dialog (or to
 * Undo, when the row it came from was just deleted).
 */
export function useCalendarUi(zone: string, weekStartsOn: number, announce: Announce): CalendarUi {
  const [target, setTarget] = useState<EventDialogTarget | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const deletion = useCalendarDelete(announce);

  const open = useCallback((next: EventDialogTarget): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTarget(next);
  }, []);

  const close = (): void => {
    setTarget(null);
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus();
    });
  };

  const openCreate = useCallback(
    (defaults: { date: string; time?: string; title?: string }): void =>
      open({ mode: 'create', ...defaults }),
    [open],
  );
  const openEdit = useCallback(
    (occurrence: CalendarOccurrence): void => open({ mode: 'edit', occurrence }),
    [open],
  );

  return {
    openCreate,
    openEdit,
    isHidden: deletion.isHidden,
    ui: (
      <>
        {target && (
          <EventDialog
            target={target}
            zone={zone}
            weekStartsOn={weekStartsOn}
            onClose={close}
            onDelete={deletion.remove}
          />
        )}
        {deletion.toast}
      </>
    ),
  };
}
