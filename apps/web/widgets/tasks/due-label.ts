/**
 * Due-date label for a task row, matching the mock's `.due` column: "today",
 * "tomorrow", a weekday name when within the next 6 days, otherwise a short
 * date. Overdue deadlines say so in text (color is never the only signal).
 * Pure — `now` is injected for testability.
 */

export interface DueLabel {
  label: string;
  isOverdue: boolean;
}

/** Parse the contract's plain-date string (YYYY-MM-DD) as a local date. */
function parseLocalDate(deadline: string): Date {
  const [year = 0, month = 1, day = 1] = deadline.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDueLabel(deadline: string, now: Date): DueLabel {
  const due = parseLocalDate(deadline);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (dayDiff < 0) {
    return { label: `overdue · ${shortDate(due)}`, isOverdue: true };
  }
  if (dayDiff === 0) return { label: 'today', isOverdue: false };
  if (dayDiff === 1) return { label: 'tomorrow', isOverdue: false };
  if (dayDiff <= 6) {
    return {
      label: due.toLocaleDateString(undefined, { weekday: 'short' }),
      isOverdue: false,
    };
  }
  return { label: shortDate(due), isOverdue: false };
}
