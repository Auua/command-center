import { PencilIcon, type WidgetDefinition } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { JournalWidget, journalSettingsSchema, type JournalSettings } from './journal-widget';
import { journalIcon } from './icon';

export const journalWidgetDefinition: WidgetDefinition<JournalSettings> = {
  id: 'journal',
  title: t('journal.title'),
  icon: journalIcon,
  accent: 'var(--cc-violet)',
  sizes: [{ w: 2, h: 2 }],
  component: JournalWidget,
  settingsSchema: journalSettingsSchema,
  defaultSettings: {},
  quickActions: [
    {
      id: 'write-journal',
      label: t('journal.quickWrite'),
      description: t('journal.quickWrite.hint'),
      icon: PencilIcon(),
    },
  ],
};
