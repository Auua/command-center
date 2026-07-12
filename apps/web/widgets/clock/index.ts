import type { WidgetDefinition } from "@command-center/ui";
import {
  ClockWidget,
  clockSettingsSchema,
  type ClockSettings,
} from "./clock-widget";
import { clockIcon } from "./icon";

export const clockWidgetDefinition: WidgetDefinition<ClockSettings> = {
  id: "clock",
  title: "Clock",
  icon: clockIcon,
  accent: "var(--cc-violet)",
  sizes: [{ w: 2, h: 1 }],
  component: ClockWidget,
  settingsSchema: clockSettingsSchema,
  defaultSettings: { hour12: false },
};
