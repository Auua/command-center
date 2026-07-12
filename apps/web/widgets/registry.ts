import { WidgetRegistry } from "@command-center/ui";
import { braindumpWidgetDefinition } from "./braindump";
import { clockWidgetDefinition } from "./clock";
import { moodWidgetDefinition } from "./mood";
import { tasksWidgetDefinition } from "./tasks";

/**
 * Client-side widget registry (ARD §4.2). Adding a widget = one folder under
 * apps/web/widgets/ + one register() call here.
 */
export const widgetRegistry = new WidgetRegistry();

widgetRegistry.register(braindumpWidgetDefinition);
widgetRegistry.register(clockWidgetDefinition);
widgetRegistry.register(moodWidgetDefinition);
widgetRegistry.register(tasksWidgetDefinition);
