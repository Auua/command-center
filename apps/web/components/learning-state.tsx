'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { RetryIcon, Skeleton, WidgetMessage } from '@command-center/ui';
import { t } from '@/lib/i18n';

/** The envelope every learning read shares (ADR-040 §API contract deltas). */
interface LearningEnvelope {
  configured: boolean;
  state?: 'ok' | 'unavailable' | 'token-invalid';
  item?: unknown;
  exhausted?: boolean;
}

interface LearningStateProps {
  query: UseQueryResult<LearningEnvelope>;
  /** Shown when the eligible set under the ceiling is empty. */
  exhaustedText: string;
  /** Shown when the read itself failed. */
  errorText: string;
}

/**
 * The non-content states of a vault-backed learning card, in one place:
 * loading skeleton, load failure (retry), vault not configured (runbook
 * pointer), token expired, vault unreachable (retry), and exhausted. Renders
 * nothing when the card has an item to show — the widget handles that.
 */
export function LearningState({
  query,
  exhaustedText,
  errorText,
}: LearningStateProps): ReactElement | null {
  const retry = {
    label: t('common.retry'),
    icon: <RetryIcon />,
    onClick: (): void => void query.refetch(),
  };
  if (query.isPending) return <Skeleton label={t('learning.loading')} />;
  const data = query.data;
  if (query.isError || !data) {
    return (
      <WidgetMessage tone="error" action={retry}>
        {errorText}
      </WidgetMessage>
    );
  }
  if (!data.configured) {
    return (
      <WidgetMessage hint={t('learning.notConfiguredHint')}>
        {t('learning.notConfigured')}
      </WidgetMessage>
    );
  }
  if (data.state === 'token-invalid') {
    return (
      <WidgetMessage tone="error" hint={t('learning.tokenInvalidHint')}>
        {t('learning.tokenInvalid')}
      </WidgetMessage>
    );
  }
  if (data.exhausted) return <WidgetMessage>{exhaustedText}</WidgetMessage>;
  if (data.state === 'unavailable' || data.item === null || data.item === undefined) {
    return (
      <WidgetMessage tone="error" action={retry}>
        {t('learning.unavailable')}
      </WidgetMessage>
    );
  }
  return null;
}
