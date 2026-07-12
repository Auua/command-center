import type { CreateTaskRequest } from "@command-center/contracts";

/**
 * Quick-add syntax parser for the Tasks widget (mock hint: "pay rent friday
 * p1"). Pure function — all date logic flows from the injected `now` so tests
 * are deterministic:
 *
 * - a trailing `p1`/`p2`/`p3` token sets priority
 * - a trailing or leading day token (`today`, `tomorrow`, or a weekday name
 *   like `mon`/`monday` meaning its next occurrence) sets the deadline
 * - `#tag` tokens anywhere become tags
 * - everything left over is the title (may come back empty — callers must
 *   refuse to submit then)
 */

const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** Local calendar date as the contract's plain-date string (YYYY-MM-DD). */
function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

/**
 * Resolve a day token to a deadline date, or null if the token isn't one.
 * Weekday names mean the *next* occurrence: typing the current weekday gets
 * next week's (there's `today` for today).
 */
function resolveDayToken(token: string, now: Date): string | null {
  const normalized = token.toLowerCase();
  if (normalized === "today") return toDateString(addDays(now, 0));
  if (normalized === "tomorrow") return toDateString(addDays(now, 1));
  const weekday = DAY_ALIASES[normalized];
  if (weekday === undefined) return null;
  const ahead = (weekday - now.getDay() + 7) % 7 || 7;
  return toDateString(addDays(now, ahead));
}

export function parseQuickAdd(input: string, now: Date): CreateTaskRequest {
  const tags: string[] = [];
  const words = input
    .trim()
    .split(/\s+/)
    .filter((token) => {
      if (token.length > 1 && token.startsWith("#")) {
        const tag = token.slice(1);
        if (!tags.includes(tag)) tags.push(tag);
        return false;
      }
      return token.length > 0;
    });

  let priority: CreateTaskRequest["priority"] = null;
  const priorityMatch = /^p([1-3])$/i.exec(words.at(-1) ?? "");
  if (priorityMatch) {
    priority = Number(priorityMatch[1]) as 1 | 2 | 3;
    words.pop();
  }

  let deadline: string | null = null;
  const lastWord = words.at(-1);
  const trailingDay = lastWord ? resolveDayToken(lastWord, now) : null;
  if (trailingDay) {
    deadline = trailingDay;
    words.pop();
  } else {
    const firstWord = words[0];
    const leadingDay = firstWord ? resolveDayToken(firstWord, now) : null;
    if (leadingDay) {
      deadline = leadingDay;
      words.shift();
    }
  }

  return { title: words.join(" "), priority, tags, deadline };
}
