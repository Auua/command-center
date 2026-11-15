import { createHash } from 'node:crypto';

/**
 * The daily prompt (ADR-017, formula from ADR-016): the same prompt all day
 * and on every device — sha256(`${userId}|${localDate}`) mod n over the
 * active prompts sorted by id. Pure, so the pick is testable without a
 * clock or a database.
 */

/** YYYY-MM-DD of `now` in `timezone`; an unknown zone falls back to UTC. */
export function localDateIn(timezone: string, now: Date = new Date()): string {
  const format = (zone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timezone);
  } catch {
    return format('UTC');
  }
}

export function pickPrompt<T extends { id: string }>(
  prompts: readonly T[],
  userId: string,
  localDate: string,
): T | null {
  if (prompts.length === 0) return null;
  const sorted = [...prompts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digest = createHash('sha256').update(`${userId}|${localDate}`).digest();
  return sorted[digest.readUInt32BE(0) % sorted.length] ?? null;
}

/** The prompt's text in `locale`, else English (always present, by schema). */
export function promptText(text: Record<string, unknown>, locale: string): string | null {
  const localized = text[locale];
  if (typeof localized === 'string' && localized.trim()) return localized;
  const english = text.en;
  return typeof english === 'string' && english.trim() ? english : null;
}
