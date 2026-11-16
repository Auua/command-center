import type { ReactElement } from 'react';
import { CalendarScreen, type CalendarView } from '@/components/calendar/calendar-screen';

const isView = (value: unknown): value is CalendarView => value === 'agenda' || value === 'month';
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value));

/** /calendar?view=agenda|month&date=YYYY-MM-DD (ADR-018). */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  return (
    <CalendarScreen
      {...(isView(params.view) ? { view: params.view } : {})}
      {...(isDate(params.date) ? { date: params.date } : {})}
    />
  );
}
