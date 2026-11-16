import { PlusIcon, type WidgetDefinition } from '@command-center/ui';
import { calendarSettingsSchema, type CalendarSettings } from '@/lib/calendar-settings';
import { t } from '@/lib/i18n';
import { CalendarWidget } from './calendar-widget';
import { calendarIcon } from './icon';

export const calendarWidgetDefinition: WidgetDefinition<CalendarSettings> = {
  id: 'calendar',
  title: t('calendar.title'),
  icon: calendarIcon,
  accent: 'var(--cc-green)',
  // Today only, or the rolling week (ADR-018).
  sizes: [
    { w: 2, h: 2 },
    { w: 4, h: 2 },
  ],
  component: CalendarWidget,
  settingsSchema: calendarSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'new-event',
      label: t('calendar.newEvent'),
      description: t('calendar.newEvent.hint'),
      icon: PlusIcon(),
    },
  ],
};
