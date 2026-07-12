import type { WidgetDefinition } from '@command-center/ui';
import { tasksIcon } from './icon';
import { TasksWidget, tasksSettingsSchema, type TasksSettings } from './tasks-widget';

export const tasksWidgetDefinition: WidgetDefinition<TasksSettings> = {
  id: 'tasks',
  title: "Today's tasks",
  icon: tasksIcon,
  accent: 'var(--cc-sky)',
  sizes: [
    { w: 2, h: 2 },
    { w: 3, h: 2 },
  ],
  component: TasksWidget,
  settingsSchema: tasksSettingsSchema,
  defaultSettings: {},
};
