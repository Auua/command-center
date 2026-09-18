import { WidgetRegistry } from '@command-center/ui';
import { braindumpWidgetDefinition } from './braindump';
import { clockWidgetDefinition } from './clock';
import { grammarWidgetDefinition } from './japanese-grammar';
import { wotdWidgetDefinition } from './japanese-wotd';
import { moodWidgetDefinition } from './mood';
import { remindersWidgetDefinition } from './reminders';
import { streaksWidgetDefinition } from './streaks';
import { tasksWidgetDefinition } from './tasks';

/**
 * Client-side widget registry (ADR §4.2). Adding a widget = one folder under
 * apps/web/widgets/ + one register() call here.
 */
export const widgetRegistry = new WidgetRegistry();

widgetRegistry.register(braindumpWidgetDefinition);
widgetRegistry.register(clockWidgetDefinition);
widgetRegistry.register(grammarWidgetDefinition);
widgetRegistry.register(wotdWidgetDefinition);
widgetRegistry.register(moodWidgetDefinition);
widgetRegistry.register(remindersWidgetDefinition);
widgetRegistry.register(streaksWidgetDefinition);
widgetRegistry.register(tasksWidgetDefinition);
