import type { JournalDoc } from '@command-center/contracts';

/** What a brand-new entry starts as — the editor's own empty document. */
export const EMPTY_JOURNAL_DOC: JournalDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** "Monday 16 November 2026" for an entry's YYYY-MM-DD (a calendar date, no timezone). */
export function formatEntryDate(entryDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${entryDate}T00:00:00Z`));
}

/** "16 Nov, 21:30" for an ISO instant, in the browser's timezone. */
export function formatSavedAt(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** YYYY-MM-DD in the browser's timezone — the fallback when the API can't say. */
export function browserToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA');
}

/** "work, Rest , work" → ["work", "rest"], at most 10, each at most 32 chars. */
export function parseTags(input: string): string[] {
  const tags = input
    .split(',')
    .map((tag) => tag.trim().toLowerCase().slice(0, 32))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 10);
}
