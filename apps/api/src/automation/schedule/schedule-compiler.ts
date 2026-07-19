import type { Schedule } from '@command-center/contracts';

/**
 * Compiles a validated schedule descriptor into a 5-field cron expression —
 * the single write path for `automations.cron_expr` (ADR-015: `schedule`
 * jsonb is the edit UI's source of truth, cron is derived server-side and
 * never user input).
 *
 * Pure and deterministic: equal descriptors compile to equal expressions
 * (the contract layer dedupes/sorts weekly days for exactly this reason).
 */
export function compileSchedule(schedule: Schedule): string {
  switch (schedule.type) {
    case 'daily': {
      const { hour, minute } = parseTime(schedule.time);
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const { hour, minute } = parseTime(schedule.time);
      // ISO 8601 weekdays (1 = Mon … 7 = Sun) → cron weekdays (0 = Sun … 6 = Sat).
      const cronDays = schedule.days.map((day) => day % 7).sort((a, b) => a - b);
      return `${minute} ${hour} * * ${cronDays.join(',')}`;
    }
    case 'interval': {
      // The contract restricts everyMinutes to values that divide evenly
      // into an hour (< 60) or into a day (multiples of 60) — a step that
      // doesn't divide evenly would reset at each hour/day boundary and lie
      // about its own period.
      if (schedule.everyMinutes < 60) {
        return `*/${schedule.everyMinutes} * * * *`;
      }
      const hours = schedule.everyMinutes / 60;
      return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
    }
  }
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  if (
    hour === undefined ||
    minute === undefined ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    // Unreachable behind ScheduleSchema; guards direct callers.
    throw new Error(`Invalid HH:mm time "${time}"`);
  }
  return { hour, minute };
}
