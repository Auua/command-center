import { CheckIcon, NextIcon, type WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { wotdIcon } from './icon';
import { WotdWidget, wotdSettingsSchema, type WotdSettings } from './wotd-widget';

export const wotdWidgetDefinition: WidgetDefinition<WotdSettings> = {
  id: 'japanese-wotd',
  title: t('wotd.title'),
  icon: wotdIcon(),
  accent: 'var(--cc-coral)',
  sizes: [
    { w: 2, h: 2 },
    { w: 3, h: 2 },
  ],
  component: WotdWidget,
  settingsSchema: wotdSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'wotd-acknowledge',
      label: t('wotd.acknowledge'),
      description: t('wotd.acknowledge.hint'),
      icon: CheckIcon(),
    },
    { id: 'wotd-skip', label: t('wotd.skip'), description: t('wotd.skip.hint'), icon: NextIcon() },
  ],
};
