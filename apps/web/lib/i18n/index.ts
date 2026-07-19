import { messages } from './messages.en';

export type MessageKey = keyof typeof messages;

/**
 * Minimal typed translator (D6): looks a key up in the catalog and
 * interpolates `{param}` placeholders. Deliberately no library — one locale,
 * compile-time-checked keys, and a seam where a real i18n runtime can slot
 * in later without touching call sites.
 *
 * Unknown placeholders are left verbatim so a typo'd param name is visible
 * in the UI (and in tests) instead of silently vanishing.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template: string = messages[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
