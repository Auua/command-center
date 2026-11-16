import type { WidgetLayoutItem } from '@command-center/contracts';
import { packLayout } from '@command-center/ui';

/**
 * The default dashboard, in order (ADR-042): every registered widget at one
 * of its declared sizes. Coordinates are derived by `packLayout`, the same
 * function the layout editor saves with — only the order and the sizes are
 * chosen here. Rendered when the API is unreachable or the user has no
 * persisted layout yet; the editor's "Reset to default" restores it.
 */
const DEFAULT_ORDER: ReadonlyArray<{ widgetId: string; w: number; h: number }> = [
  { widgetId: 'clock', w: 2, h: 1 },
  { widgetId: 'braindump', w: 2, h: 2 },
  { widgetId: 'mood', w: 2, h: 2 },
  { widgetId: 'tasks', w: 2, h: 2 },
  { widgetId: 'reminders', w: 4, h: 2 },
  { widgetId: 'streaks', w: 2, h: 3 },
  // The reflection pair (ADR-017: appreciation beside Journal).
  { widgetId: 'journal', w: 2, h: 2 },
  { widgetId: 'appreciation', w: 2, h: 2 },
  { widgetId: 'japanese-wotd', w: 2, h: 2 },
  { widgetId: 'japanese-kanji', w: 2, h: 2 },
  { widgetId: 'japanese-grammar', w: 3, h: 2 },
];

export const DEFAULT_LAYOUT: WidgetLayoutItem[] = packLayout(
  DEFAULT_ORDER.map(({ widgetId, w, h }) => ({
    widgetId,
    instanceKey: '',
    gridPos: { x: 0, y: 0, w, h },
    settings: {},
  })),
);
