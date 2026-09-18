'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';
import { fetchAnkiStatus } from '@/lib/learning-api';
import { formatRelativeTime } from '@/lib/relative-time';

export const ANKI_STATUS_QUERY_KEY = ['learning', 'anki-status'];

/**
 * ADR-026's three honest states for a learning card footer: synced N ago,
 * N waiting for sync, failed — view run. Never a spinner implying live
 * connectivity; renders nothing while loading or when the status read
 * itself fails (the card stays fully functional regardless of sync health).
 */
export function AnkiSyncStatus(): ReactElement | null {
  const { data } = useQuery({
    queryKey: ANKI_STATUS_QUERY_KEY,
    queryFn: fetchAnkiStatus,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  if (!data || !data.configured || data.state !== 'ok') return null;

  if (data.lastRunStatus === 'failed') {
    return (
      <span className="cc-anki-status cc-anki-status-failed">
        <span aria-hidden="true">⚠</span> {t('anki.failed')}{' '}
        <a href={data.lastRunUrl ?? data.actionsUrl} target="_blank" rel="noreferrer noopener">
          {t('anki.viewRun')}
        </a>
      </span>
    );
  }
  if (data.lastRunStatus === 'never') {
    return (
      <span className="cc-anki-status">
        <a href={data.actionsUrl} target="_blank" rel="noreferrer noopener">
          {t('anki.never')}
        </a>
      </span>
    );
  }
  if (data.pendingCommits > 0) {
    return (
      <span className="cc-anki-status cc-anki-status-pending">
        <span aria-hidden="true">◔</span> {t('anki.pending', { count: data.pendingCommits })}
      </span>
    );
  }
  return (
    <span className="cc-anki-status cc-anki-status-synced">
      <span aria-hidden="true">✓</span>{' '}
      {data.lastSyncAt
        ? t('anki.synced', { when: formatRelativeTime(data.lastSyncAt) })
        : t('anki.never')}
    </span>
  );
}
