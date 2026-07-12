import { describe, expect, it } from "vitest";
import { formatDueLabel } from "./due-label";

// Friday 10 July 2026, mid-day — time of day must not shift the labels.
const now = new Date(2026, 6, 10, 15, 30, 0);

// Locale-dependent expectations use the same Intl formatting as the helper,
// so these tests assert branch selection, not the runner's locale.
function weekdayName(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

describe("formatDueLabel", () => {
  it("labels the current day 'today'", () => {
    expect(formatDueLabel("2026-07-10", now)).toEqual({
      label: "today",
      isOverdue: false,
    });
  });

  it("labels the next day 'tomorrow'", () => {
    expect(formatDueLabel("2026-07-11", now)).toEqual({
      label: "tomorrow",
      isOverdue: false,
    });
  });

  it("uses the weekday name when within the next 6 days", () => {
    expect(formatDueLabel("2026-07-13", now).label).toBe(
      weekdayName(new Date(2026, 6, 13)),
    );
    // The 6-day boundary (Thursday 16 July) still gets a weekday name.
    expect(formatDueLabel("2026-07-16", now).label).toBe(
      weekdayName(new Date(2026, 6, 16)),
    );
  });

  it("falls back to a short date from 7 days out", () => {
    expect(formatDueLabel("2026-07-17", now)).toEqual({
      label: shortDate(new Date(2026, 6, 17)),
      isOverdue: false,
    });
  });

  it("says 'overdue' in text for past deadlines (never color alone)", () => {
    expect(formatDueLabel("2026-07-08", now)).toEqual({
      label: `overdue · ${shortDate(new Date(2026, 6, 8))}`,
      isOverdue: true,
    });
  });
});
