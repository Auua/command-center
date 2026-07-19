import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';

/** Grid footprint a widget occupies, in dashboard grid units. */
export interface WidgetSize {
  w: number;
  h: number;
}

export interface QuickAction {
  id: string;
  /** Accessible name of the action button (always announced to AT). */
  label: string;
  /**
   * Optional compact glyph (e.g. a "+" SVG) rendered instead of the label
   * text inside the header button; the label becomes the aria-label.
   */
  icon?: ReactNode;
}

export interface WidgetProps<TSettings = unknown> {
  settings: TSettings;
  size: WidgetSize;
}

/**
 * The widget contract (ADR §4.2). Adding a widget means adding one folder
 * under apps/web/widgets/ and one registry entry — no core changes.
 */
export interface WidgetDefinition<TSettings = unknown> {
  id: string;
  title: string;
  /**
   * Header chip icon (design mock's .chip-icon). Rendered inside a small
   * rounded square tinted with the widget's accent color.
   */
  icon?: ReactNode;
  /**
   * Widget accent color (design mock's --wc), as a CSS color value —
   * usually one of the palette tokens, e.g. "var(--cc-sky)".
   */
  accent?: string;
  sizes: WidgetSize[];
  component: ComponentType<WidgetProps<TSettings>>;
  settingsSchema: z.ZodType<TSettings>;
  defaultSettings: TSettings;
  quickActions?: QuickAction[];
}
