import type { Schedule } from '@command-center/contracts';

/**
 * Pure mapping between the builder form's "When" fields and the contract's
 * `Schedule` descriptor — the "mis-parsed schedule = missed reminder" hot
 * spot (ADR-015), so it is total, side-effect free, and heavily tested.
 * Cron never appears here: the API compiles `Schedule` server-side.
 */

export type DayChoice = 'every-day' | 'weekdays' | 'weekends' | 'custom';

export interface TimedScheduleForm {
  /** HH:mm from a native `<input type="time">` ('' when unset). */
  time: string;
  dayChoice: DayChoice;
  /** ISO weekdays 1 (Mon) – 7 (Sun); only read when dayChoice is 'custom'. */
  customDays: number[];
}

export type ScheduleFromFormResult =
  { ok: true; schedule: Schedule } | { ok: false; error: 'invalid-time' | 'no-days' };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_DAYS: readonly number[] = [1, 2, 3, 4, 5];
export const WEEKEND_DAYS: readonly number[] = [6, 7];

export function scheduleFromForm(form: TimedScheduleForm): ScheduleFromFormResult {
  if (!TIME_PATTERN.test(form.time)) {
    return { ok: false, error: 'invalid-time' };
  }

  switch (form.dayChoice) {
    case 'every-day':
      return { ok: true, schedule: { type: 'daily', time: form.time } };
    case 'weekdays':
      return { ok: true, schedule: { type: 'weekly', time: form.time, days: [...WEEKDAY_DAYS] } };
    case 'weekends':
      return { ok: true, schedule: { type: 'weekly', time: form.time, days: [...WEEKEND_DAYS] } };
    case 'custom': {
      const days = [...new Set(form.customDays)]
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
        .sort((a, b) => a - b);
      if (days.length === 0) {
        return { ok: false, error: 'no-days' };
      }
      if (days.length === 7) {
        // All seven days IS daily — normalize so equal intents compare equal.
        return { ok: true, schedule: { type: 'daily', time: form.time } };
      }
      return { ok: true, schedule: { type: 'weekly', time: form.time, days } };
    }
  }
}

function sameDays(days: number[], expected: readonly number[]): boolean {
  return days.length === expected.length && expected.every((day, index) => days[index] === day);
}

/**
 * Inverse mapping for edit-mode prefill. Returns null for `interval`
 * schedules — the v1 builder has no interval UI (ADR-015 fields), so the
 * modal shows them read-only and leaves the schedule untouched on save.
 */
export function formFromSchedule(schedule: Schedule): TimedScheduleForm | null {
  switch (schedule.type) {
    case 'interval':
      return null;
    case 'daily':
      return { time: schedule.time, dayChoice: 'every-day', customDays: [] };
    case 'weekly': {
      const days = [...new Set(schedule.days)].sort((a, b) => a - b);
      if (days.length === 7) {
        return { time: schedule.time, dayChoice: 'every-day', customDays: [] };
      }
      if (sameDays(days, WEEKDAY_DAYS)) {
        return { time: schedule.time, dayChoice: 'weekdays', customDays: [] };
      }
      if (sameDays(days, WEEKEND_DAYS)) {
        return { time: schedule.time, dayChoice: 'weekends', customDays: [] };
      }
      return { time: schedule.time, dayChoice: 'custom', customDays: days };
    }
  }
}
