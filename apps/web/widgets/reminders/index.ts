import type { WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { plusIcon, remindersIcon } from './icon';
import {
  RemindersWidget,
  remindersSettingsSchema,
  type RemindersSettings,
} from './reminders-widget';

export const remindersWidgetDefinition: WidgetDefinition<RemindersSettings> = {
  id: 'reminders',
  title: t('reminders.title'),
  icon: remindersIcon(),
  accent: 'var(--cc-violet)',
  sizes: [
    { w: 4, h: 2 },
    { w: 4, h: 3 },
  ],
  component: RemindersWidget,
  settingsSchema: remindersSettingsSchema,
  defaultSettings: {},
  quickActions: [{ id: 'add-automation', label: t('reminders.add'), icon: plusIcon() }],
};
