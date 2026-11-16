'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { CalendarOccurrence, Task } from '@command-center/contracts';
import {
  addDays,
  addMonths,
  formatDay,
  formatMonth,
  formatTime,
  monthGridDays,
  startOfWeek,
  weekdayNames,
} from '@/lib/calendar-dates';
import { t } from '@/lib/i18n';

/** Event chips a cell shows before "+N more". */
const CHIPS = 3;

export interface MonthGridProps {
  /** The focused day; its month is the one shown. */
  focused: string;
  today: string;
  weekStartsOn: number;
  byDay: ReadonlyMap<string, readonly CalendarOccurrence[]>;
  tasksByDay: ReadonlyMap<string, readonly Task[]>;
  zone: string;
  /** Focus moved (keys or a click) — may be into another month. */
  onFocusChange: (date: string) => void;
  /** Enter, Space or a click: show that day's events. */
  onOpenDay: (date: string) => void;
  /** Typing on a day starts a new event there, with what was typed. */
  onQuickCreate: (date: string, title: string) => void;
}

/**
 * The month grid (ADR-018's accessibility contract): `role="grid"` with
 * localised column headers, one tabbable cell (roving tabindex), Arrow keys
 * by day / week, PageUp/PageDown by month (Shift: year), Home/End to the
 * week's ends. Each cell's name carries the data ("Tuesday 14 July, 2
 * events"); the chips are decoration — the day panel lists the events.
 * Days outside the month are real, navigable cells, only muted.
 */
export function MonthGrid({
  focused,
  today,
  weekStartsOn,
  byDay,
  tasksByDay,
  zone,
  onFocusChange,
  onOpenDay,
  onQuickCreate,
}: MonthGridProps): ReactElement {
  const labelId = useId();
  const weeks = monthGridDays(focused, weekStartsOn);
  const names = weekdayNames(weekStartsOn);
  const month = focused.slice(0, 7);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const moveFocus = useRef(false);

  // Keyboard moves focus the new cell once it is rendered (maybe in a new month).
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    cells.current.get(focused)?.focus();
  }, [focused]);

  const go = (date: string): void => {
    moveFocus.current = true;
    onFocusChange(date);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, day: string): void => {
    const weekStart = startOfWeek(day, weekStartsOn);
    const step: Record<string, string> = {
      ArrowLeft: addDays(day, -1),
      ArrowRight: addDays(day, 1),
      ArrowUp: addDays(day, -7),
      ArrowDown: addDays(day, 7),
      PageUp: addMonths(day, event.shiftKey ? -12 : -1),
      PageDown: addMonths(day, event.shiftKey ? 12 : 1),
      Home: weekStart,
      End: addDays(weekStart, 6),
    };
    const next = step[event.key];
    if (next) {
      event.preventDefault();
      go(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenDay(day);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onQuickCreate(day, event.key);
    }
  };

  return (
    <div className="cc-month">
      <h2 id={labelId} className="cc-month-title">
        {formatMonth(focused)}
      </h2>
      <div
        role="grid"
        aria-labelledby={labelId}
        aria-rowcount={weeks.length + 1}
        aria-colcount={7}
        className="cc-month-grid"
      >
        <div role="row" className="cc-month-row cc-month-head" aria-rowindex={1}>
          {names.map((name, index) => (
            <div
              key={name.long}
              role="columnheader"
              aria-label={name.long}
              aria-colindex={index + 1}
              className="cc-month-weekday"
            >
              {name.short}
            </div>
          ))}
        </div>
        {weeks.map((week, row) => (
          <div key={week[0]} role="row" className="cc-month-row" aria-rowindex={row + 2}>
            {week.map((day, column) => {
              const events = byDay.get(day) ?? [];
              const tasks = tasksByDay.get(day) ?? [];
              const count = events.length + tasks.length;
              const label = formatDay(day, Number(today.slice(0, 4)));
              const name =
                count === 0
                  ? t('calendar.cell.none', { day: label })
                  : count === 1
                    ? t('calendar.cell.one', { day: label })
                    : t('calendar.cell', { day: label, count });
              return (
                <div
                  key={day}
                  ref={(node) => {
                    if (node) cells.current.set(day, node);
                    else cells.current.delete(day);
                  }}
                  role="gridcell"
                  aria-colindex={column + 1}
                  aria-label={name}
                  aria-current={day === today ? 'date' : undefined}
                  aria-selected={day === focused}
                  tabIndex={day === focused ? 0 : -1}
                  className="cc-month-cell"
                  data-outside={day.slice(0, 7) !== month || undefined}
                  data-today={day === today || undefined}
                  onKeyDown={(event) => onKeyDown(event, day)}
                  onClick={() => {
                    onFocusChange(day);
                    onOpenDay(day);
                  }}
                >
                  <span className="cc-month-day" aria-hidden="true">
                    {Number(day.slice(8))}
                  </span>
                  <span className="cc-month-chips" aria-hidden="true">
                    {events.slice(0, CHIPS).map((occurrence) => (
                      <span
                        key={`${occurrence.seriesId}|${occurrence.occurrenceStart}`}
                        className="cc-month-chip"
                        data-all-day={occurrence.allDay || undefined}
                      >
                        {!occurrence.allDay && (
                          <span className="cc-month-chip-time">
                            {formatTime(occurrence.startsAt, zone)}
                          </span>
                        )}
                        {occurrence.title}
                      </span>
                    ))}
                    {tasks.slice(0, Math.max(0, CHIPS - events.length)).map((task) => (
                      <span key={task.id} className="cc-month-chip" data-task>
                        {task.title}
                      </span>
                    ))}
                    {count > CHIPS && (
                      <span className="cc-month-more">
                        {t('calendar.more', { count: count - CHIPS })}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
