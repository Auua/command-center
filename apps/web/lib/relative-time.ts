/**
 * Compact relative timestamps for notification rows ("just now", "5 min.
 * ago", "yesterday", else a local date). Locale-aware via Intl — no
 * hand-rolled unit strings (NFR-12).
 */
export function formatRelativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  if (seconds < 60) return relative.format(0, 'second'); // "now"
  if (seconds < 3600) return relative.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400) return relative.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 7 * 86_400) return relative.format(-Math.round(seconds / 86_400), 'day');
  return then.toLocaleDateString(locale);
}
