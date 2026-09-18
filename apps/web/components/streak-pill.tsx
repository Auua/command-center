'use client';

import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';
import { useStreaks } from '@/lib/use-streaks';

/**
 * Compact "N-day streak" pill for a learning card (ADR-011/012 frontend
 * composition). Renders nothing while loading, on error, or at zero — a
 * failed streaks read must never break the card that hosts it.
 */
export function StreakPill({ streakKey }: { streakKey: string }): ReactElement | null {
  const { data } = useStreaks();
  const streak = data?.streaks.find((entry) => entry.streakKey === streakKey);
  if (!streak || streak.currentLen === 0) return null;
  return (
    <span className={`cc-streak-pill${streak.activeToday ? '' : ' cc-streak-pill-pending'}`}>
      <span aria-hidden="true">🔥</span> {t('streaks.pill', { count: streak.currentLen })}
      {!streak.activeToday && (
        <span className="cc-visually-hidden"> {t('streaks.todayPending')}</span>
      )}
    </span>
  );
}
