'use client';

import type { ReactElement, ReactNode } from 'react';
import type { CalendarOccurrence, Task } from '@command-center/contracts';
import { addDays, formatDay, formatTime, groupByDay, wallClockOf } from '@/lib/calendar-dates';
import { t } from '@/lib/i18n';

export interface AgendaProps {
  /** The days the agenda covers, in order. Days with nothing on them are left out. */
  days: readonly string[];
  occurrences: readonly CalendarOccurrence[];
  /** Read-only deadline markers (ADR-018's task overlay), already filtered. */
  tasks?: readonly Task[];
  zone: string;
  today: string;
  onOpen: (occurrence: CalendarOccurrence) => void;
  /** Shown when no day has anything on it. */
  empty: ReactNode;
  /** `h3` on the page and in the card (ADR-018: a list of days with date headings). */
  headingLevel?: 'h3' | 'h4';
}

const RepeatGlyph = (): ReactElement => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

/** "09:00–10:30", or "All day". */
export function timeLabel(occurrence: CalendarOccurrence, zone: string): string {
  if (occurrence.allDay) return t('calendar.allDay');
  return `${formatTime(occurrence.startsAt, zone)}–${formatTime(occurrence.endsAt, zone)}`;
}

export function dayLabel(day: string, today: string, tomorrow: string): string {
  if (day === today) return `${t('calendar.today')} · ${formatDay(day, Number(today.slice(0, 4)))}`;
  if (day === tomorrow) {
    return `${t('calendar.tomorrow')} · ${formatDay(day, Number(today.slice(0, 4)))}`;
  }
  return formatDay(day, Number(today.slice(0, 4)));
}

/**
 * The agenda (ADR-018): a semantic list of days, each with a date heading
 * and its events in order — the screen-reader-preferred view and the
 * card's only one. Each event is a button that opens it; task deadlines
 * are read-only markers.
 */
export function Agenda({
  days,
  occurrences,
  tasks = [],
  zone,
  today,
  onOpen,
  empty,
  headingLevel = 'h3',
}: AgendaProps): ReactElement {
  const byDay = groupByDay(occurrences, zone);
  const tomorrow = addDays(today, 1);
  const Heading = headingLevel;
  const shown = days.filter(
    (day) => (byDay.get(day)?.length ?? 0) > 0 || tasks.some((task) => task.deadline === day),
  );
  if (shown.length === 0) return <>{empty}</>;

  return (
    <ol className="cc-agenda">
      {shown.map((day) => (
        <li key={day} className="cc-agenda-day">
          <Heading className="cc-agenda-date">{dayLabel(day, today, tomorrow)}</Heading>
          <ul className="cc-agenda-items">
            {(byDay.get(day) ?? []).map((occurrence) => (
              <li key={`${occurrence.seriesId}|${occurrence.occurrenceStart}`}>
                <button type="button" className="cc-agenda-item" onClick={() => onOpen(occurrence)}>
                  <span className="cc-agenda-time">
                    {timeLabel(occurrence, zone)}
                    {!occurrence.allDay && wallClockOf(occurrence.startsAt, zone).date !== day && (
                      <span className="cc-visually-hidden">
                        {' '}
                        ({formatDay(wallClockOf(occurrence.startsAt, zone).date)})
                      </span>
                    )}
                  </span>{' '}
                  <span className="cc-agenda-title">
                    {occurrence.title}
                    {occurrence.isRecurring && (
                      <>
                        <span className="cc-visually-hidden">, {t('calendar.repeats')}</span>
                        <span
                          className="cc-agenda-repeat"
                          title={t('calendar.repeats')}
                          aria-hidden="true"
                        >
                          <RepeatGlyph />
                        </span>
                      </>
                    )}
                  </span>
                  {occurrence.location && (
                    <>
                      {' '}
                      <span className="cc-agenda-location">{occurrence.location}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
            {tasks
              .filter((task) => task.deadline === day)
              .map((task) => (
                <li key={`task|${task.id}`} className="cc-agenda-task">
                  <span className="cc-agenda-time">{t('calendar.task')}</span>{' '}
                  <span className="cc-agenda-title">{task.title}</span>
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
