import type { WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { flameIcon } from './icon';
import { StreaksWidget, streaksSettingsSchema, type StreaksSettings } from './streaks-widget';

export const streaksWidgetDefinition: WidgetDefinition<StreaksSettings> = {
  id: 'streaks',
  title: t('streaks.title'),
  icon: flameIcon(),
  accent: 'var(--cc-amber)',
  sizes: [
    { w: 2, h: 2 },
    { w: 2, h: 3 },
  ],
  component: StreaksWidget,
  settingsSchema: streaksSettingsSchema,
  defaultSettings: {},
};
