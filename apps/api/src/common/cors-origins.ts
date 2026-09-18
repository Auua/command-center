/**
 * CORS_ORIGIN parsing. Entries are exact origins, or a glob with `*` that
 * matches one DNS label segment (letters, digits, dashes) — enough to allow
 * Vercel preview deployments of the web project without listing each
 * branch: `https://command-center-web-*-<team>.vercel.app`. `*` never
 * crosses a dot or a slash, so a glob cannot widen to other hosts.
 */
export type OriginMatcher = (origin: string) => boolean;

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\/]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
  return new RegExp(`^${escaped}$`, 'i');
}

export function buildOriginMatcher(entries: string[]): OriginMatcher {
  const exact = new Set(entries.filter((entry) => !entry.includes('*')));
  const globs = entries.filter((entry) => entry.includes('*')).map(globToRegExp);
  return (origin) => exact.has(origin) || globs.some((pattern) => pattern.test(origin));
}
