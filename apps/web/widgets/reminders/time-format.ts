import type { Schedule } from '@command-center/contracts';
import { t } from '@/lib/i18n';

/**
 * Wall-clock formatting for the reminders widget. Today-slot `at` values
 * arrive as ISO strings carrying the user's stored-timezone offset — the
 * HH:mm digits in the string ARE the wall time to show, so they are read
 * textually rather than round-tripped through the browser timezone
 * (ADR-015: display in the stored timezone).
 */

export type HourCycleSetting = 'h12' | 'h23' | 'auto';

const WALL_TIME = /(?:^|T)(\d{2}):(\d{2})/;

/** Formats 'HH:mm' or an ISO datetime's wall time per locale + hourCycle. */
export function formatWallTime(
  value: string,
  hourCycle: HourCycleSetting = 'auto',
  locale?: string,
): string {
  const match = WALL_TIME.exec(value);
  if (!match) return value;
  const sample = new Date(2001, 0, 1, Number(match[1]), Number(match[2]));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(hourCycle === 'auto' ? {} : { hourCycle }),
  }).format(sample);
}

/**
 * Formats a UTC instant (e.g. a run's `firedAt`) as browser-local time.
 * Unlike today-slot `at` strings, these carry no user-tz offset — the
 * browser timezone is the best available proxy (single-user app).
 */
export function formatInstantTime(
  iso: string,
  hourCycle: HourCycleSetting = 'auto',
  locale?: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(hourCycle === 'auto' ? {} : { hourCycle }),
  }).format(date);
}

/** Locale short weekday names, Monday-first (ISO order, matching days 1–7). */
export function isoWeekdayShortNames(locale?: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2001-01-01 was a Monday; use noon to dodge DST edges.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(2001, 0, 1 + index, 12)),
  );
}

/** One-line schedule summary, e.g. "12:00 daily" or "08:30 · weekdays". */
export function describeSchedule(
  schedule: Schedule,
  hourCycle: HourCycleSetting = 'auto',
  locale?: string,
): string {
  switch (schedule.type) {
    case 'daily':
      return t('schedule.daily', { time: formatWallTime(schedule.time, hourCycle, locale) });
    case 'weekly': {
      const names = isoWeekdayShortNames(locale);
      const days = [...new Set(schedule.days)].sort((a, b) => a - b);
      const daysLabel =
        days.length === 5 && days.every((day, index) => day === index + 1)
          ? t('schedule.weekdays')
          : days.length === 2 && days[0] === 6 && days[1] === 7
            ? t('schedule.weekends')
            : days.map((day) => names[day - 1]).join(', ');
      return t('schedule.weekly', {
        time: formatWallTime(schedule.time, hourCycle, locale),
        days: daysLabel,
      });
    }
    case 'interval':
      return schedule.everyMinutes < 60
        ? t('schedule.everyMinutes', { minutes: schedule.everyMinutes })
        : t('schedule.everyHours', { hours: schedule.everyMinutes / 60 });
  }
}
