import type { WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { checkIcon, grammarIcon, nextIcon } from './icon';
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
    { id: 'grammar-studied', label: t('grammar.studied'), icon: checkIcon() },
    { id: 'grammar-advance', label: t('grammar.next'), icon: nextIcon() },
  ],
};
