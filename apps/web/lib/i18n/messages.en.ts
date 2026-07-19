/**
 * English message catalog (NFR-12, decision D6). The single source of user
 * copy: components call t('key') instead of embedding literals, so adding a
 * locale later means adding one file — not hunting strings. `{name}`
 * placeholders are interpolated by t()'s params argument.
 *
 * Key convention: '<area>.<name>', areas matching the surface (shell, pwa,
 * widget ids…). Keep keys sorted within their area block.
 */
export const messages = {
  'shell.loadingDashboard': 'Loading dashboard…',
  'shell.unknownWidget': 'Unknown widget "{id}". It may have been removed or not registered yet.',
} as const satisfies Record<string, string>;
