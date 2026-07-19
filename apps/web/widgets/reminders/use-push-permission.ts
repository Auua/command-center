'use client';

import { useCallback, useEffect, useState } from 'react';
import { isIos, isStandalone, supportsPush } from '@/lib/pwa';
import { subscribeToPush, type SubscribeResult } from '@/lib/push';
import { derivePermissionUx, type PermissionUx } from './permission-state';

const DISMISSED_KEY = 'cc:reminders-banner-dismissed';

function readPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

function readDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Wires derivePermissionUx() to the live environment. `enable()` is the
 * widget banner's path into subscribeToPush() — the app's single
 * Notification.requestPermission() call site (ADR-015).
 */
export function usePushPermission(hasEnabledTimedAutomation: boolean): {
  ux: PermissionUx;
  enable: () => Promise<SubscribeResult>;
  dismiss: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermission>(readPermission);
  const [dismissed, setDismissed] = useState(readDismissed);

  // Permission can change outside enable() (browser site settings); refresh
  // whenever the tab regains focus.
  useEffect(() => {
    const refresh = (): void => setPermission(readPermission());
    window.addEventListener('focus', refresh);
    return (): void => window.removeEventListener('focus', refresh);
  }, []);

  const enable = useCallback(async (): Promise<SubscribeResult> => {
    const result = await subscribeToPush();
    setPermission(readPermission());
    return result;
  }, []);

  const dismiss = useCallback((): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Session-only dismissal is fine.
    }
  }, []);

  const ux = derivePermissionUx({
    supported: supportsPush(),
    permission,
    isIos: isIos(),
    isStandalone: isStandalone(),
    hasEnabledTimedAutomation,
    dismissed,
  });

  return { ux, enable, dismiss };
}
