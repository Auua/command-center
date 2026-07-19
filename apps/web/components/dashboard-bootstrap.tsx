'use client';

import { useEffect, useRef } from 'react';
import { isValidIanaTimeZone } from '@command-center/contracts';
import { fetchProfile, updateProfile } from '@/lib/profile-api';
import { reconcileSubscription } from '@/lib/push';

/**
 * One-time per-mount dashboard side effects (renders nothing):
 *
 * - D4 timezone auto-capture: if no profile row exists yet, upsert the
 *   browser's IANA timezone so the scheduler and today endpoint have one.
 *   Manual override UI is Phase 4 polish.
 * - Push subscription reconcile: iff permission is already granted,
 *   re-subscribe + re-upsert this browser's endpoint (heals rotation,
 *   D2 — no pushsubscriptionchange endpoint). Never prompts.
 *
 * Both are best-effort: failures are silent and retried on next app open.
 */
export function DashboardBootstrap(): null {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard
    ran.current = true;

    void (async (): Promise<void> => {
      try {
        const profile = await fetchProfile();
        if (profile === null) {
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (timezone && isValidIanaTimeZone(timezone)) {
            await updateProfile({ timezone });
          }
        }
      } catch {
        // Best-effort; the API defaults to UTC until captured.
      }
    })();

    void reconcileSubscription();
  }, []);

  return null;
}
