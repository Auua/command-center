import type { WidgetDefinition } from '@command-center/ui';
import {
  BraindumpWidget,
  braindumpSettingsSchema,
  type BraindumpSettings,
} from './braindump-widget';
import { braindumpIcon } from './icon';

export const braindumpWidgetDefinition: WidgetDefinition<BraindumpSettings> = {
  id: 'braindump',
  title: 'Braindump',
  icon: braindumpIcon,
  accent: 'var(--cc-sky)',
  sizes: [
    { w: 2, h: 2 },
    { w: 3, h: 2 },
  ],
  component: BraindumpWidget,
  settingsSchema: braindumpSettingsSchema,
  defaultSettings: {},
};
