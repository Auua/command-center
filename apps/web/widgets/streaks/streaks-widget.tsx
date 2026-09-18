'use client';

import type { ReactElement } from 'react';
import { z } from 'zod';
import { STREAK_KEYS, type Streak } from '@command-center/contracts';
import type { WidgetProps } from '@command-center/ui';
import { t, type MessageKey } from '@/lib/i18n';
import { messages } from '@/lib/i18n/messages.en';
import { useStreaks } from '@/lib/use-streaks';

export const streaksSettingsSchema = z.object({
  visible: z.array(z.enum(STREAK_KEYS)).default([...STREAK_KEYS]),
  showBest: z.boolean().default(true),
});

export type StreaksSettings = z.input<typeof streaksSettingsSchema>;

const MILESTONES = [7, 30, 100, 365];

const catalog: Record<string, string> = messages;

/** Display name for a streak key — catalog, never the API (ADR-014). */
export function streakName(streakKey: string): string {
  const key = `streaks.name.${streakKey}`;
  return key in catalog ? t(key as MessageKey) : streakKey;
}

function StreakRow({ streak, showBest }: { streak: Streak; showBest: boolean }): ReactElement {
  const name = streakName(streak.streakKey);
  const activeCount = streak.last7.filter(Boolean).length;
  const milestone = MILESTONES.includes(streak.currentLen) && streak.activeToday;
  const label = [
    t('streaks.row.label', { name, count: streak.currentLen }),
    showBest ? t('streaks.row.best', { best: streak.bestLen }) : '',
    streak.activeToday ? t('streaks.row.activeToday') : t('streaks.todayPending'),
    t('streaks.row.last7', { active: activeCount }),
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className="cc-streak-row" aria-label={label}>
      <span
        className={`cc-streak-count${streak.activeToday ? '' : ' cc-streak-count-pending'}`}
        aria-hidden="true"
      >
        {streak.currentLen}
      </span>
      <span className="cc-streak-main" aria-hidden="true">
        <span className="cc-streak-name">
          {name}
          {milestone && (
            <span className="cc-streak-milestone">
              {' '}
              {t('streaks.milestone', { count: streak.currentLen })}
            </span>
          )}
        </span>
        <span className="cc-streak-sub">
          {streak.activeToday ? t('streaks.row.activeToday') : t('streaks.todayPending')}
          {showBest ? ` · ${t('streaks.row.best', { best: streak.bestLen })}` : ''}
        </span>
      </span>
      <span className="cc-streak-dots" aria-hidden="true">
        {streak.last7.map((active, index) => (
          <span key={index} className={`cc-streak-dot${active ? ' cc-streak-dot-on' : ''}`} />
        ))}
      </span>
    </li>
  );
}

/**
 * Streaks (ADR-014): a read-only aggregation of other widgets' activity.
 * No quick actions, no "at risk" nudges — the only signal is the passive
 * "today pending" state; broken streaks read neutrally.
 */
export function StreaksWidget({ settings }: WidgetProps<StreaksSettings>): ReactElement {
  const visible = settings.visible ?? [...STREAK_KEYS];
  const showBest = settings.showBest ?? true;
  const query = useStreaks();

  if (query.isPending) {
    return (
      <ul className="cc-streak-list" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className="cc-streak-row cc-streak-ghost">
            <span className="cc-streak-count" />
            <span className="cc-streak-main">
              <span className="cc-wotd-ghost" />
              <span className="cc-wotd-ghost cc-wotd-ghost-short" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="cc-wotd-state">
        <p className="cc-wotd-error">{t('streaks.error')}</p>
        <button type="button" className="cc-btn" onClick={() => void query.refetch()}>
          {t('wotd.retry')}
        </button>
      </div>
    );
  }

  const streaks = query.data.streaks.filter((streak) =>
    (visible as readonly string[]).includes(streak.streakKey),
  );
  if (streaks.length === 0) {
    return <p className="cc-streak-empty">{t('streaks.empty')}</p>;
  }
  const best = Math.max(...streaks.map((streak) => streak.bestLen));

  return (
    <div className="cc-streaks">
      <ul className="cc-streak-list">
        {streaks.map((streak) => (
          <StreakRow key={streak.streakKey} streak={streak} showBest={showBest} />
        ))}
      </ul>
      {showBest && <p className="cc-streak-footer">{t('streaks.allTimeBest', { best })}</p>}
    </div>
  );
}
