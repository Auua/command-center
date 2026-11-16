import { t } from '@/lib/i18n';
import { weekdayNames, weekdayOf } from './calendar-dates';

/**
 * The event dialog's "Repeat" choices ↔ an RRULE (ADR-018). The client only
 * *writes* rules — it never expands one; the server does. The subset is what
 * the dialog can say: daily / weekly on chosen weekdays / monthly / yearly,
 * every N, ending never, on a date or after N times. A stored rule outside
 * it reads as `'custom'` and is kept as it is unless the user replaces it.
 */

export type RepeatFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const REPEAT_FREQUENCIES: readonly RepeatFrequency[] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
];

export type RepeatEnd =
  { kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number };

export interface RepeatForm {
  frequency: RepeatFrequency;
  interval: number;
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekdays: number[];
  end: RepeatEnd;
}

export const NO_REPEAT: RepeatForm = {
  frequency: 'none',
  interval: 1,
  weekdays: [],
  end: { kind: 'never' },
};

const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const FREQ: Record<Exclude<RepeatFrequency, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

/** The rule for the form, or null for "doesn't repeat". */
export function rruleFromForm(form: RepeatForm, startDate: string): string | null {
  if (form.frequency === 'none') return null;
  const parts = [`FREQ=${FREQ[form.frequency]}`];
  if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`);
  if (form.frequency === 'weekly') {
    const days = form.weekdays.length > 0 ? form.weekdays : [weekdayOf(startDate)];
    parts.push(
      `BYDAY=${[...new Set(days)]
        .sort((a, b) => a - b)
        .map((d) => CODES[d])
        .join(',')}`,
    );
  }
  // UNTIL is read in the series' wall clock: the end of that day there.
  if (form.end.kind === 'until') parts.push(`UNTIL=${form.end.date.replaceAll('-', '')}T235959Z`);
  if (form.end.kind === 'count') parts.push(`COUNT=${form.end.count}`);
  return parts.join(';');
}

/** The form for a stored rule; `'custom'` when the dialog can't express it. */
export function formFromRrule(rule: string | null): RepeatForm | 'custom' {
  if (!rule) return NO_REPEAT;
  const fields = new Map<string, string>();
  for (const part of rule.replace(/^RRULE:/i, '').split(';')) {
    const [key, value] = part.split('=');
    if (!key || value === undefined || fields.has(key.toUpperCase())) return 'custom';
    fields.set(key.toUpperCase(), value.toUpperCase());
  }
  const frequency = (Object.keys(FREQ) as (keyof typeof FREQ)[]).find(
    (name) => FREQ[name] === fields.get('FREQ'),
  );
  if (!frequency) return 'custom';
  for (const key of fields.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT'].includes(key)) return 'custom';
  }

  const interval = Number(fields.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1) return 'custom';

  let weekdays: number[] = [];
  const byDay = fields.get('BYDAY');
  if (byDay !== undefined) {
    if (frequency !== 'weekly') return 'custom';
    weekdays = byDay.split(',').map((code) => CODES.indexOf(code as (typeof CODES)[number]));
    if (weekdays.some((day) => day < 0)) return 'custom';
  }

  let end: RepeatEnd = { kind: 'never' };
  const until = fields.get('UNTIL');
  const count = fields.get('COUNT');
  if (until && count) return 'custom';
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(until);
    if (!match) return 'custom';
    end = { kind: 'until', date: `${match[1]}-${match[2]}-${match[3]}` };
  } else if (count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return 'custom';
    end = { kind: 'count', count: n };
  }
  return { frequency, interval, weekdays, end };
}

/** "Every 2 weeks on Tue, Thu · until 31 Dec 2026" — for the agenda and the dialog. */
export function describeRepeat(form: RepeatForm | 'custom'): string {
  if (form === 'custom') return t('calendar.repeat.custom');
  if (form.frequency === 'none') return t('calendar.repeat.none');
  const every =
    form.interval > 1
      ? t(`calendar.repeat.everyN.${form.frequency}`, { n: form.interval })
      : t(`calendar.repeat.every.${form.frequency}`);
  const names = weekdayNames(0);
  const on =
    form.frequency === 'weekly' && form.weekdays.length > 0
      ? ` ${t('calendar.repeat.on', {
          days: [...form.weekdays]
            .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
            .map((d) => names[d]?.short ?? '')
            .join(', '),
        })}`
      : '';
  const end =
    form.end.kind === 'until'
      ? ` · ${t('calendar.repeat.until', {
          date: new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${form.end.date}T00:00:00Z`)),
        })}`
      : form.end.kind === 'count'
        ? ` · ${t('calendar.repeat.times', { count: form.end.count })}`
        : '';
  return `${every}${on}${end}`;
}
