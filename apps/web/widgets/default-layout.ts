import type { WidgetLayoutItem } from "@command-center/contracts";

/**
 * Fallback layout used when the API is unreachable or the user has no
 * persisted layout yet.
 */
export const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  {
    widgetId: "clock",
    gridPos: { x: 0, y: 0, w: 2, h: 1 },
    settings: {},
  },
];
