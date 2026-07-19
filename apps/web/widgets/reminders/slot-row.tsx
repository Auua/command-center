'use client';

import type { ReactElement } from 'react';
import type { TodayRun } from '@command-center/contracts';
import { t } from '@/lib/i18n';
import { formatInstantTime, formatWallTime, type HourCycleSetting } from './time-format';

interface SlotRowProps {
  automationId: string;
  name: string;
  enabled: boolean;
  /** ISO `at` with user-tz offset for timed slots; undefined for event rows. */
  at?: string;
  /** Run outcome for past slots / last run for event automations. */
  run?: TodayRun;
  hourCycle: HourCycleSetting;
  /** Row is part of an in-flight toggle mutation — subtle pending style. */
  pending: boolean;
  onToggle: (automationId: string, enabled: boolean, name: string) => void;
  onEdit: (automationId: string) => void;
}

function runStatusText(run: TodayRun, hourCycle: HourCycleSetting): string {
  switch (run.status) {
    case 'sent':
      return t('reminders.status.sent', {
        time: run.firedAt ? formatInstantTime(run.firedAt, hourCycle) : '',
      }).trim();
    case 'failed':
      return t('reminders.status.failed');
    case 'skipped':
      return t('reminders.status.skipped');
  }
}

/**
 * One reminder row (ADR-015 accessibility rules): the row is NOT one click
 * target — the name is a button opening the edit modal, the switch is a
 * separate native checkbox (role="switch", ≥44px hit area), and the row
 * background is inert. Paused state is dimming + a "Paused" text token +
 * the switch position — never color alone; statuses are glyph + text.
 */
export function SlotRow({
  automationId,
  name,
  enabled,
  at,
  run,
  hourCycle,
  pending,
  onToggle,
  onEdit,
}: SlotRowProps): ReactElement {
  const classes = ['cc-rem-row'];
  if (!enabled) classes.push('cc-rem-row-paused');
  if (pending) classes.push('cc-rem-row-pending');

  return (
    <li className={classes.join(' ')}>
      {at ? (
        <time className="cc-rem-time" dateTime={at}>
          {formatWallTime(at, hourCycle)}
        </time>
      ) : (
        <span className="cc-rem-time cc-rem-time-event" aria-hidden="true">
          ⚡
        </span>
      )}
      <button
        type="button"
        className="cc-rem-name"
        aria-label={t('reminders.editLabel', { name })}
        onClick={() => onEdit(automationId)}
      >
        {name}
      </button>
      {!enabled && <span className="cc-rem-paused-token">{t('reminders.paused')}</span>}
      {enabled && run && (
        <span className={`cc-rem-status cc-rem-status-${run.status}`} data-status={run.status}>
          {runStatusText(run, hourCycle)}
        </span>
      )}
      {/* Native checkbox styled as a switch: focus, Space toggling and
          checked-state semantics come free (ADR-015). Label = identity only;
          state lives in the checked/switch state. */}
      <label className="cc-rem-switch">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          aria-label={t('reminders.switchLabel', { name })}
          onChange={() => onToggle(automationId, !enabled, name)}
        />
        <span className="cc-rem-switch-track" aria-hidden="true" />
      </label>
    </li>
  );
}
