'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { SaveStatus } from '@/lib/journal-autosave';
import { t, type MessageKey } from '@/lib/i18n';

const LABEL: Record<SaveStatus, MessageKey> = {
  idle: 'journal.status.idle',
  pending: 'journal.status.saving',
  saving: 'journal.status.saving',
  saved: 'journal.status.saved',
  offline: 'journal.status.offline',
  conflict: 'journal.status.conflict',
  rejected: 'journal.status.rejected',
};

/** States worth interrupting for; "saved" only after one of these. */
const ANNOUNCED = new Set<SaveStatus>(['offline', 'conflict', 'rejected']);

/**
 * The save indicator (ADR-016): always visible, and a polite live region
 * that speaks *transitions* only — it never chatters "Saving… Saved" on
 * every pause in typing. It announces going offline / a conflict / a
 * refusal, and "Saved" once things recover.
 */
export function SaveStatusIndicator({
  status,
  isNew,
  durable,
}: {
  status: SaveStatus;
  isNew: boolean;
  durable: boolean;
}): ReactElement {
  const [spoken, setSpoken] = useState('');
  const lastAnnounced = useRef<SaveStatus | null>(null);

  useEffect(() => {
    if (ANNOUNCED.has(status) && lastAnnounced.current !== status) {
      lastAnnounced.current = status;
      setSpoken(t(LABEL[status]));
    } else if (status === 'saved' && lastAnnounced.current && lastAnnounced.current !== 'saved') {
      lastAnnounced.current = 'saved';
      setSpoken(t('journal.status.saved'));
    }
  }, [status]);

  const label = status === 'idle' && isNew ? t('journal.status.new') : t(LABEL[status]);
  return (
    <div className="cc-journal-status" data-status={status}>
      <span aria-hidden="true">{label}</span>
      {!durable && <span className="cc-hint">{t('journal.status.notDurable')}</span>}
      <p className="cc-visually-hidden" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}
