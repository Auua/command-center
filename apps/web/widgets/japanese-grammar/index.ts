import { CheckIcon, NextIcon, type WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { grammarIcon } from './icon';
import { GrammarWidget, grammarSettingsSchema, type GrammarSettings } from './grammar-widget';

export const grammarWidgetDefinition: WidgetDefinition<GrammarSettings> = {
  id: 'japanese-grammar',
  title: t('grammar.title'),
  icon: grammarIcon(),
  accent: 'var(--cc-coral)',
  sizes: [
    { w: 3, h: 2 },
    { w: 3, h: 3 },
  ],
  component: GrammarWidget,
  settingsSchema: grammarSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'grammar-studied',
      label: t('grammar.studied'),
      description: t('grammar.studied.hint'),
      icon: CheckIcon(),
    },
    {
      id: 'grammar-advance',
      label: t('grammar.next'),
      description: t('grammar.next.hint'),
      icon: NextIcon(),
    },
  ],
};
