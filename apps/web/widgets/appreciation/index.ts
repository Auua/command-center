import { PlusIcon, type WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import {
  AppreciationWidget,
  appreciationSettingsSchema,
  type AppreciationSettings,
} from './appreciation-widget';
import { appreciationIcon } from './icon';

export const appreciationWidgetDefinition: WidgetDefinition<AppreciationSettings> = {
  id: 'appreciation',
  title: t('appreciation.title'),
  icon: appreciationIcon,
  accent: 'var(--cc-pink)',
  // Compact (input + a few lines) and tall (room for "Show more").
  sizes: [
    { w: 2, h: 2 },
    { w: 2, h: 3 },
  ],
  component: AppreciationWidget,
  settingsSchema: appreciationSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'add-appreciation',
      label: t('appreciation.quickAdd'),
      description: t('appreciation.quickAdd.hint'),
      icon: PlusIcon(),
    },
  ],
};
