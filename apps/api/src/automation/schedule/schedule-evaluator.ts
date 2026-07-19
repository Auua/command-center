import { CronExpressionParser } from 'cron-parser';

/**
 * Occurrence window, half-open at the start: slots satisfy
 * `start < slot <= end`. The tick passes `(cursor_at, now]` so consecutive
 * windows tile with no gap and no double-count; the today endpoint passes
 * the user's local calendar day.
 */
export interface EvaluationWindow {
  /** Exclusive lower bound. */
  start: Date;
  /** Inclusive upper bound. */
  end: Date;
}

/**
 * Hard bound on returned occurrences per automation per call. A 5-minute
 * interval over the 60-minute catch-up cap is 12 slots; a full day of the
 * densest allowed schedule is 288 — 1000 means a runaway expression can
 * never wedge a tick.
 */
const MAX_OCCURRENCES = 1000;

/**
 * The one schedule evaluator (ADR-015/039): expands a compiled cron
 * expression into UTC occurrence instants inside a window, evaluated in the
 * user's IANA timezone. Serves both the scheduler tick and
 * `GET /automations/today`, so widget preview and firing can never disagree
 * — including across DST transitions, whose behavior is pinned empirically
 * in schedule-evaluator.spec.ts (cron-parser v5):
 *
 * - Spring forward (Europe/Helsinki 2026-03-29, 03:00 → 04:00): a daily time
 *   inside the skipped hour fires once, shifted one hour later on the wall
 *   clock — never lost, never doubled.
 * - Fall back (2026-10-25, 04:00 → 03:00): a daily time inside the repeated
 *   hour fires once (first pass); interval schedules keep firing every real
 *   period, so repeated local times occur twice as *distinct UTC slots* —
 *   `UNIQUE (automation_id, slot)` treats them as two legitimate fires.
 *
 * Pure: no clock access — callers own `now` (the tick's service injects a
 * now() provider; tests pass fixed windows).
 */
export function expandOccurrences(
  cronExpr: string,
  timezone: string,
  window: EvaluationWindow,
): Date[] {
  if (window.end.getTime() <= window.start.getTime()) {
    return [];
  }

  // cron-parser yields occurrences strictly after currentDate, matching the
  // exclusive window start; the explicit `> start` filter below is a
  // belt-and-braces guard on that library behavior (pinned in the spec).
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: window.start,
    tz: timezone,
  });

  const occurrences: Date[] = [];
  while (occurrences.length < MAX_OCCURRENCES) {
    let next: Date;
    try {
      next = interval.next().toDate();
    } catch {
      break; // iterator exhausted (bounded expressions)
    }
    if (next.getTime() > window.end.getTime()) {
      break;
    }
    if (next.getTime() > window.start.getTime()) {
      occurrences.push(next);
    }
  }
  return occurrences;
}
