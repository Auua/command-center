import { z } from "zod";

export const GridPosSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type GridPos = z.infer<typeof GridPosSchema>;

export const WidgetLayoutItemSchema = z.object({
  widgetId: z.string().min(1),
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
