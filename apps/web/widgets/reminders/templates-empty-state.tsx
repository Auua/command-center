'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { AutomationTemplate } from '@command-center/contracts';
import { fetchAutomationTemplates } from '@/lib/automations-api';
import { t } from '@/lib/i18n';
import { describeSchedule, type HourCycleSetting } from './time-format';

interface TemplatesEmptyStateProps {
  hourCycle: HourCycleSetting;
  creating: boolean;
  /** One tap creates the template enabled, then opens it in the editor. */
  onCreateFromTemplate: (template: AutomationTemplate) => void;
}

/**
 * First-run empty state (ADR-015): one explaining paragraph + one-tap
 * starter templates fetched from the API (copy versions with the server,
 * not the bundle). If templates can't load, the intro + the header "+"
 * still offer the manual path.
 */
export function TemplatesEmptyState({
  hourCycle,
  creating,
  onCreateFromTemplate,
}: TemplatesEmptyStateProps): ReactElement {
  const templatesQuery = useQuery({
    queryKey: ['automations', 'templates'],
    queryFn: fetchAutomationTemplates,
  });

  return (
    <div className="cc-rem-empty">
      <p>{t('reminders.empty.intro')}</p>
      {templatesQuery.isSuccess && templatesQuery.data.items.length > 0 && (
        <ul className="cc-rem-templates">
          {templatesQuery.data.items.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="cc-rem-template"
                disabled={creating}
                onClick={() => onCreateFromTemplate(template)}
              >
                <span className="cc-rem-template-name">{template.name}</span>
                <span className="cc-rem-template-schedule">
                  {describeSchedule(template.schedule, hourCycle)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="cc-widget-placeholder">{t('reminders.empty.addHint')}</p>
    </div>
  );
}
