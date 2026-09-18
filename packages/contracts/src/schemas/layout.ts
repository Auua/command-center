import { z } from 'zod';

export const GridPosSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type GridPos = z.infer<typeof GridPosSchema>;

/**
 * `widgetId` is the registry lookup key; `instanceKey` tells apart several
 * placements of the same definition (ADR-013's per-track widgets). Empty for
 * the ordinary single-instance case.
 */
export const WidgetLayoutItemSchema = z.object({
  widgetId: z.string().min(1),
  instanceKey: z.string().max(64).default(''),
  gridPos: GridPosSchema,
  settings: z.record(z.unknown()).default({}),
});
export type WidgetLayoutItem = z.infer<typeof WidgetLayoutItemSchema>;

export const LayoutResponseSchema = z.object({
  items: z.array(WidgetLayoutItemSchema),
});
export type LayoutResponse = z.infer<typeof LayoutResponseSchema>;

export const PutLayoutRequestSchema = z.object({
  items: z.array(WidgetLayoutItemSchema),
});
export type PutLayoutRequest = z.infer<typeof PutLayoutRequestSchema>;
