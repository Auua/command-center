import { WidgetRegistry } from "@command-center/ui";
import { clockWidgetDefinition } from "./clock";

/**
 * Client-side widget registry (ARD §4.2). Adding a widget = one folder under
 * apps/web/widgets/ + one register() call here.
 */
export const widgetRegistry = new WidgetRegistry();

widgetRegistry.register(clockWidgetDefinition);
