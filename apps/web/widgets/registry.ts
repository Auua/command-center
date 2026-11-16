import { WidgetRegistry } from '@command-center/ui';
import { appreciationWidgetDefinition } from './appreciation';
import { braindumpWidgetDefinition } from './braindump';
import { calendarWidgetDefinition } from './calendar';
import { clockWidgetDefinition } from './clock';
import { grammarWidgetDefinition } from './japanese-grammar';
import { kanjiWidgetDefinition } from './japanese-kanji';
import { wotdWidgetDefinition } from './japanese-wotd';
import { journalWidgetDefinition } from './journal';
import { moodWidgetDefinition } from './mood';
import { remindersWidgetDefinition } from './reminders';
import { streaksWidgetDefinition } from './streaks';
import { tasksWidgetDefinition } from './tasks';

/**
 * Client-side widget registry (ADR §4.2). Adding a widget = one folder under
 * apps/web/widgets/ + one register() call here.
 */
export const widgetRegistry = new WidgetRegistry();

widgetRegistry.register(appreciationWidgetDefinition);
widgetRegistry.register(braindumpWidgetDefinition);
widgetRegistry.register(calendarWidgetDefinition);
widgetRegistry.register(clockWidgetDefinition);
widgetRegistry.register(grammarWidgetDefinition);
widgetRegistry.register(kanjiWidgetDefinition);
widgetRegistry.register(wotdWidgetDefinition);
widgetRegistry.register(journalWidgetDefinition);
widgetRegistry.register(moodWidgetDefinition);
widgetRegistry.register(remindersWidgetDefinition);
widgetRegistry.register(streaksWidgetDefinition);
widgetRegistry.register(tasksWidgetDefinition);
