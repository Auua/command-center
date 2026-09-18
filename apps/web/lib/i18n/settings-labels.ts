import { messages } from './messages.en';
import { t, type MessageKey } from './index';

/**
 * Label for a widget settings field: `settings.<widgetId>.<field>` in the
 * catalog when present, else the raw field name — so a new widget's panel
 * works before its copy is written and the missing key is visible.
 */
export function settingsFieldLabel(widgetId: string, field: string): string {
  const key = `settings.${widgetId}.${field}`;
  return key in messages ? t(key as MessageKey) : field;
}
