import type { WidgetDefinition } from "@command-center/ui";
import { moodIcon } from "./icon";
import {
  MoodWidget,
  moodSettingsSchema,
  type MoodSettings,
} from "./mood-widget";

export const moodWidgetDefinition: WidgetDefinition<MoodSettings> = {
  id: "mood",
  title: "Mood check-in",
  icon: moodIcon,
  accent: "var(--cc-amber)",
  sizes: [
    { w: 2, h: 2 },
    { w: 3, h: 2 },
  ],
  component: MoodWidget,
  settingsSchema: moodSettingsSchema,
  defaultSettings: {},
};
