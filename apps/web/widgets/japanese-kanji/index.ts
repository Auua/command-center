import { CheckIcon, NextIcon, type WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { kanjiIcon } from './icon';
import { KanjiWidget, kanjiSettingsSchema, type KanjiSettings } from './kanji-widget';

export const kanjiWidgetDefinition: WidgetDefinition<KanjiSettings> = {
  id: 'japanese-kanji',
  title: t('kanji.title'),
  icon: kanjiIcon(),
  accent: 'var(--cc-coral)',
  sizes: [
    { w: 2, h: 2 },
    { w: 3, h: 2 },
    { w: 3, h: 3 },
  ],
  component: KanjiWidget,
  settingsSchema: kanjiSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'kanji-acknowledge',
      label: t('kanji.acknowledge'),
      description: t('kanji.acknowledge.hint'),
      icon: CheckIcon(),
    },
    {
      id: 'kanji-skip',
      label: t('kanji.skip'),
      description: t('kanji.skip.hint'),
      icon: NextIcon(),
    },
  ],
};
