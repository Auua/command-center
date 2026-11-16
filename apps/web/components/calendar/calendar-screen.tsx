'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Button,
  ErrorText,
  Hint,
  PlusIcon,
  RetryIcon,
  Skeleton,
  useAnnouncer,
  WidgetMessage,
} from '@command-center/ui';
import { calendarRangeKey, fetchCalendarRange } from '@/lib/calendar-api';
import {
  addDays,
  addMonths,
  browserZone,
  daysBetween,
  formatDay,
  formatMonth,
  groupByDay,
  monthGridDays,
  todayIn,
  wallClockOf,
} from '@/lib/calendar-dates';
import { useCalendarSettings, useHomeZone, WEEK_START } from '@/lib/calendar-settings';
import { t } from '@/lib/i18n';
import { Agenda } from './agenda';
import { MonthGrid } from './month-grid';
import { useCalendarUi } from './use-calendar-ui';
import { tasksByDay, useTaskDeadlines } from './use-task-deadlines';

export type CalendarView = 'agenda' | 'month';
const AGENDA_DAYS = 30;
const AGENDA_MAX_DAYS = 360;

export const calendarHref = (view: CalendarView, date: string): string =>
  `/calendar?view=${view}&date=${date}`;

/** The next whole hour today in `zone` (ADR-018's quick-create default). */
export function nextRoundHour(
  zone: string,
  now: Date = new Date(),
): { date: string; time: string } {
  const wall = wallClockOf(now.toISOString(), zone);
  const hour = Number(wall.time.slice(0, 2));
  return { date: wall.date, time: `${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00` };
}

/**
 * The calendar's expanded view (ADR-018, `/calendar?view=&date=`): Agenda —
 * the screen-reader-preferred default — and Month. View and date live in
 * the URL, so paging is linkable and Back walks it. Day and week views are
 * step 4D-2. A failed range keeps the last good one on screen with a
 * banner rather than blanking it.
 */
export function CalendarScreen({
  view: urlView,
  date: urlDate,
}: {
  view?: CalendarView;
  date?: string;
}): ReactElement {
  const router = useRouter();
  const settings = useCalendarSettings();
  const zone = useHomeZone();
  const today = todayIn(zone);
  const view = urlView ?? settings.defaultView;
  const weekStartsOn = WEEK_START[settings.weekStartsOn];
  const { announce, regions } = useAnnouncer();
  const calendar = useCalendarUi(zone, weekStartsOn, announce);

  const [focused, setFocused] = useState(urlDate ?? today);
  const [agendaDays, setAgendaDays] = useState(AGENDA_DAYS);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const dayPanel = useRef<HTMLElement>(null);

  // Back/forward (or a new link) moves the date under a mounted page.
  useEffect(() => {
    setFocused(urlDate ?? today);
    setOpenDay(null);
  }, [urlDate, today]);

  const go = (nextView: CalendarView, date: string): void => {
    router.push(calendarHref(nextView, date), { scroll: false });
  };

  const range = useMemo(() => {
    if (view === 'month') {
      const weeks = monthGridDays(focused, weekStartsOn);
      return { from: weeks[0]?.[0] ?? focused, to: addDays(weeks.at(-1)?.at(-1) ?? focused, 1) };
    }
    return { from: focused, to: addDays(focused, agendaDays) };
  }, [view, focused, weekStartsOn, agendaDays]);

  // Without a view in the URL, the card's "opens in" setting decides — wait for it.
  const viewKnown = urlView !== undefined || settings.loaded;
  const query = useQuery({
    queryKey: calendarRangeKey(range.from, range.to),
    queryFn: () => fetchCalendarRange(range.from, range.to),
    placeholderData: keepPreviousData,
    enabled: viewKnown,
  });
  const tasks = useTaskDeadlines(
    settings.loaded && settings.showTaskDeadlines,
    range.from,
    range.to,
  );
  const shownZone = query.data?.timeZone ?? zone;
  const occurrences = (query.data?.occurrences ?? []).filter((o) => !calendar.isHidden(o));
  const byDay = groupByDay(occurrences, shownZone);
  const deadlines = tasksByDay(tasks);

  // Say where the view landed (ADR-018: view changes are announced) — per
  // month in Month view, not per focused day.
  const place =
    view === 'month'
      ? t('calendar.view.announce.month', { month: formatMonth(`${focused.slice(0, 7)}-01`) })
      : t('calendar.view.announce.agenda', { day: formatDay(focused) });
  useEffect(() => announce('polite', place), [announce, place]);

  useEffect(() => {
    if (openDay) dayPanel.current?.focus();
  }, [openDay]);

  const step = (direction: 1 | -1): void =>
    go(
      view,
      view === 'month' ? addMonths(focused, direction) : addDays(focused, direction * agendaDays),
    );

  const newEvent = (date?: string): void => {
    const next = nextRoundHour(shownZone);
    calendar.openCreate(date && date !== next.date ? { date, time: '09:00' } : next);
  };

  const agendaRange = Array.from({ length: daysBetween(range.from, range.to) }, (_, i) =>
    addDays(range.from, i),
  );

  return (
    <div className="cc-calendar-screen">
      {regions}
      <div className="cc-calendar-bar">
        <div role="group" aria-label={t('calendar.view.label')} className="cc-calendar-views">
          {(['agenda', 'month'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="cc-btn cc-btn-ghost cc-btn-sm"
              aria-pressed={view === option}
              onClick={() => go(option, focused)}
            >
              {t(`calendar.view.${option}`)}
            </button>
          ))}
        </div>
        <div className="cc-calendar-nav">
          <Button variant="ghost" size="sm" onClick={() => step(-1)}>
            <span aria-hidden="true">←</span> {t(`calendar.prev.${view}`)}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go(view, today)}>
            {t('calendar.goToday')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => step(1)}>
            {t(`calendar.next.${view}`)} <span aria-hidden="true">→</span>
          </Button>
        </div>
        <span className="cc-dialog-footer-spacer" />
        <Button onClick={() => newEvent(view === 'month' ? focused : undefined)}>
          <span aria-hidden="true">
            <PlusIcon />
          </span>
          {t('calendar.newEvent')}
        </Button>
      </div>
      {shownZone !== browserZone() && <Hint>{t('calendar.zoneNote', { zone: shownZone })}</Hint>}
      {query.isError && query.data && <ErrorText>{t('calendar.staleError')}</ErrorText>}

      {!viewKnown || query.isPending ? (
        <Skeleton shapes={['row', 'row', 'row', 'row']} label={t('calendar.loading')} />
      ) : query.isError && !query.data ? (
        <WidgetMessage
          tone="error"
          action={{
            label: t('common.retry'),
            icon: <RetryIcon />,
            onClick: () => void query.refetch(),
          }}
        >
          {t('calendar.error')}
        </WidgetMessage>
      ) : view === 'month' ? (
        <>
          <MonthGrid
            focused={focused}
            today={today}
            weekStartsOn={weekStartsOn}
            byDay={byDay}
            tasksByDay={deadlines}
            zone={shownZone}
            onFocusChange={(date) => {
              setFocused(date);
              if (date.slice(0, 7) !== focused.slice(0, 7)) go('month', date);
            }}
            onOpenDay={setOpenDay}
            onQuickCreate={(date, title) => calendar.openCreate({ date, time: '09:00', title })}
          />
          {openDay && (
            <section
              ref={dayPanel}
              tabIndex={-1}
              className="cc-calendar-day-panel"
              aria-label={formatDay(openDay)}
            >
              <Agenda
                days={[openDay]}
                occurrences={occurrences}
                tasks={tasks}
                zone={shownZone}
                today={today}
                onOpen={calendar.openEdit}
                empty={
                  <>
                    <h3 className="cc-agenda-date">{formatDay(openDay)}</h3>
                    <WidgetMessage tone="empty">{t('calendar.empty')}</WidgetMessage>
                  </>
                }
              />
              <div className="cc-calendar-day-actions">
                <Button size="sm" onClick={() => newEvent(openDay)}>
                  {t('calendar.day.new')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpenDay(null);
                    document.querySelector<HTMLElement>('.cc-month-cell[tabindex="0"]')?.focus();
                  }}
                >
                  {t('calendar.day.close')}
                </Button>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <Agenda
            days={agendaRange}
            occurrences={occurrences}
            tasks={tasks}
            zone={shownZone}
            today={today}
            onOpen={calendar.openEdit}
            empty={
              <WidgetMessage
                tone="empty"
                action={{
                  label: t('calendar.newEvent'),
                  icon: <PlusIcon />,
                  onClick: () => newEvent(),
                }}
              >
                {t('calendar.empty')}
              </WidgetMessage>
            }
          />
          {agendaDays < AGENDA_MAX_DAYS && (
            <Button
              variant="ghost"
              busy={query.isFetching}
              onClick={() => setAgendaDays((days) => Math.min(AGENDA_MAX_DAYS, days + AGENDA_DAYS))}
            >
              {t('calendar.later')}
            </Button>
          )}
        </>
      )}
      {calendar.ui}
    </div>
  );
}
