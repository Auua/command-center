'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  Hint,
  PlusIcon,
  RetryIcon,
  Skeleton,
  useAnnouncer,
  useQuickAction,
  WidgetBody,
  WidgetMessage,
  type WidgetProps,
} from '@command-center/ui';
import { Agenda } from '@/components/calendar/agenda';
import { nextRoundHour } from '@/components/calendar/calendar-screen';
import { useCalendarUi } from '@/components/calendar/use-calendar-ui';
import { useTaskDeadlines } from '@/components/calendar/use-task-deadlines';
import { calendarRangeKey, fetchCalendarRange } from '@/lib/calendar-api';
import { addDays, browserZone, todayIn } from '@/lib/calendar-dates';
import {
  resolveCalendarSettings,
  useHomeZone,
  WEEK_START,
  type CalendarSettings,
} from '@/lib/calendar-settings';
import { t } from '@/lib/i18n';

/** Today plus the next seven days — one range, so both card sizes share the cache. */
const WINDOW_DAYS = 8;

/**
 * The calendar card (ADR-018): a compact agenda — today at 2×2, the rolling
 * week at 4×2 — with "New event" in the chrome and a link to the full
 * calendar. Never a month grid: at card size it would be unreadable.
 */
export function CalendarWidget({ settings, size }: WidgetProps<CalendarSettings>): ReactElement {
  const resolved = resolveCalendarSettings(settings);
  const zone = useHomeZone();
  const today = todayIn(zone);
  const to = addDays(today, WINDOW_DAYS);
  const { announce, regions } = useAnnouncer();
  const calendar = useCalendarUi(zone, WEEK_START[resolved.weekStartsOn], announce);

  const range = useQuery({
    queryKey: calendarRangeKey(today, to),
    queryFn: () => fetchCalendarRange(today, to),
  });
  const tasks = useTaskDeadlines(resolved.showTaskDeadlines, today, to);

  const newEvent = (): void => calendar.openCreate(nextRoundHour(range.data?.timeZone ?? zone));
  useQuickAction('new-event', newEvent);

  const wide = size.w >= 4;
  const days = wide ? Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i)) : [today];
  const shownZone = range.data?.timeZone ?? zone;

  let body: ReactElement;
  if (range.isPending) {
    body = <Skeleton shapes={['line', 'line', 'short']} label={t('calendar.loading')} />;
  } else if (range.isError) {
    body = (
      <WidgetMessage
        tone="error"
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void range.refetch(),
        }}
      >
        {t('calendar.error')}
      </WidgetMessage>
    );
  } else {
    body = (
      <Agenda
        days={days}
        occurrences={range.data.occurrences.filter((o) => !calendar.isHidden(o))}
        tasks={tasks}
        zone={shownZone}
        today={today}
        onOpen={calendar.openEdit}
        empty={
          <WidgetMessage
            tone="empty"
            action={{ label: t('calendar.newEvent'), icon: <PlusIcon />, onClick: newEvent }}
          >
            {t('calendar.empty')}
          </WidgetMessage>
        }
      />
    );
  }

  return (
    <WidgetBody>
      {regions}
      <div className="cc-calendar-card">
        {body}
        <div className="cc-calendar-card-footer">
          {shownZone !== browserZone() && (
            <Hint>{t('calendar.zoneNote', { zone: shownZone })}</Hint>
          )}
          <Link href="/calendar" className="cc-btn cc-btn-ghost cc-btn-sm">
            {t('calendar.open')}
          </Link>
        </div>
      </div>
      {calendar.ui}
    </WidgetBody>
  );
}
