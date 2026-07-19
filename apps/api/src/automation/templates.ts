import type { AutomationTemplate } from '@command-center/contracts';

/**
 * Starter templates for the widget's empty state (ADR-015): served from the
 * API so copy and schedules version with the server, not the bundle.
 * Creating from a template goes through the normal POST /automations path —
 * templates are data, not a second write path.
 */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'hydration-break',
    name: 'Hydration break',
    kind: 'recurring',
    schedule: { type: 'daily', time: '12:00' },
    action: { type: 'notify', title: 'Hydration break', body: 'Time for a glass of water.' },
  },
  {
    id: 'afternoon-mood-check-in',
    name: 'Afternoon mood check-in',
    kind: 'recurring',
    schedule: { type: 'daily', time: '15:00' },
    action: { type: 'notify', title: 'Mood check-in time', body: 'How is the afternoon going?' },
  },
  {
    id: 'journal-before-bed',
    name: 'Journal before bed',
    kind: 'recurring',
    schedule: { type: 'daily', time: '21:30' },
    action: { type: 'notify', title: 'Journal before bed', body: 'A few lines before sleep.' },
  },
];
