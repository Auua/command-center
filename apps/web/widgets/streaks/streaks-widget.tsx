'use client';

import type { ReactElement } from 'react';
import { z } from 'zod';
import { STREAK_KEYS, type Streak } from '@command-center/contracts';
import {
  List,
  ListItem,
  RetryIcon,
  Skeleton,
  WidgetBody,
  WidgetMessage,
  type WidgetProps,
} from '@command-center/ui';
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
    <ListItem className="cc-streak-row" aria-label={label}>
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
        <span className="cc-hint">
          {streak.activeToday ? t('streaks.row.activeToday') : t('streaks.todayPending')}
          {showBest ? ` · ${t('streaks.row.best', { best: streak.bestLen })}` : ''}
        </span>
      </span>
      <span className="cc-streak-dots" aria-hidden="true">
        {streak.last7.map((active, index) => (
          <span key={index} className={`cc-streak-dot${active ? ' cc-streak-dot-on' : ''}`} />
        ))}
      </span>
    </ListItem>
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
    return <Skeleton shapes={['row', 'row', 'row']} label={t('streaks.loading')} />;
  }
  if (query.isError || !query.data) {
    return (
      <WidgetMessage
        tone="error"
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void query.refetch(),
        }}
      >
        {t('streaks.error')}
      </WidgetMessage>
    );
  }

  const streaks = query.data.streaks.filter((streak) =>
    (visible as readonly string[]).includes(streak.streakKey),
  );
  if (streaks.length === 0) {
    return <WidgetMessage>{t('streaks.empty')}</WidgetMessage>;
  }
  const best = Math.max(...streaks.map((streak) => streak.bestLen));

  return (
    <WidgetBody>
      <List>
        {streaks.map((streak) => (
          <StreakRow key={streak.streakKey} streak={streak} showBest={showBest} />
        ))}
      </List>
      {showBest && <p className="cc-hint cc-streak-footer">{t('streaks.allTimeBest', { best })}</p>}
    </WidgetBody>
  );
}
