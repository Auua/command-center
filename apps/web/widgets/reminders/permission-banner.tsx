'use client';

import { useState, type ReactElement } from 'react';
import { t } from '@/lib/i18n';
import type { SubscribeResult } from '@/lib/push';
import type { PermissionUx } from './permission-state';

interface PermissionBannerProps {
  ux: PermissionUx;
  onEnable: () => Promise<SubscribeResult>;
  onDismiss: () => void;
  /** Announce through the widget's persistent live regions. */
  announce: (kind: 'polite' | 'alert', message: string) => void;
}

/**
 * Delivery-state surface under the widget header (ADR-015): the dismissible
 * enable-push banner (permission 'default'), the "In-app only" badge
 * (denied/unsupported), or the iOS install hint. Never rendered when
 * ux === 'hidden'.
 */
export function PermissionBanner({
  ux,
  onEnable,
  onDismiss,
  announce,
}: PermissionBannerProps): ReactElement | null {
  const [busy, setBusy] = useState(false);

  if (ux === 'hidden') return null;

  if (ux === 'prompt-banner') {
    const handleEnable = async (): Promise<void> => {
      setBusy(true);
      try {
        const result = await onEnable();
        if (result.status === 'subscribed') {
          announce('polite', t('reminders.banner.enabled'));
        } else if (result.status !== 'denied') {
          // denied re-renders as the in-app-only badge — that IS the message.
          announce('alert', t('reminders.banner.error'));
        }
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="cc-rem-banner">
        <p>{t('reminders.banner.text')}</p>
        <button
          type="button"
          className="cc-btn cc-rem-banner-enable"
          disabled={busy}
          onClick={() => void handleEnable()}
        >
          {t('reminders.banner.enable')}
        </button>
        <button
          type="button"
          className="cc-rem-banner-dismiss"
          aria-label={t('reminders.banner.dismiss')}
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    );
  }

  return (
    <p className="cc-rem-badge">
      <span className="cc-rem-badge-token">{t('reminders.inAppOnly')}</span>{' '}
      {t('reminders.inAppOnlyDetail')}
      {ux === 'ios-install-hint' && <> {t('reminders.iosHint')}</>}
    </p>
  );
}
