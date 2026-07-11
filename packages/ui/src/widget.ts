import type { ComponentType } from "react";
import type { z } from "zod";

/** Grid footprint a widget occupies, in dashboard grid units. */
export interface WidgetSize {
  w: number;
  h: number;
}

export interface QuickAction {
  id: string;
  label: string;
}

export interface WidgetProps<TSettings = unknown> {
  settings: TSettings;
  size: WidgetSize;
}

/**
 * The widget contract (ARD §4.2). Adding a widget means adding one folder
 * under apps/web/widgets/ and one registry entry — no core changes.
 */
export interface WidgetDefinition<TSettings = unknown> {
  id: string;
  title: string;
  sizes: WidgetSize[];
  component: ComponentType<WidgetProps<TSettings>>;
  settingsSchema: z.ZodType<TSettings>;
  defaultSettings: TSettings;
  quickActions?: QuickAction[];
}
