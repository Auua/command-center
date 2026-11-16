'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import { Skeleton } from '@command-center/ui';
import { t } from '@/lib/i18n';
import type { JournalEditorScreenProps } from './journal-editor-screen';

/**
 * The editor bundle (TipTap + ProseMirror) loads only on the journal's
 * editor routes, client-side — never on the dashboard (ADR-016, NFR-1).
 */
const JournalEditorScreen = dynamic(() => import('./journal-editor-screen'), {
  ssr: false,
  loading: () => (
    <Skeleton shapes={['title', 'line', 'line', 'short']} label={t('journal.loading')} />
  ),
});

export function JournalEditorLoader(props: JournalEditorScreenProps): ReactElement {
  return <JournalEditorScreen {...props} />;
}
