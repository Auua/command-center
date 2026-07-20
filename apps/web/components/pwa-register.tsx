'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js once on mount (Phase 2 plan §4). The worker only handles
 * push + notification clicks — no fetch handler, so registering it never
 * affects page loads. Failure is non-fatal: the app works without push, and
 * the notification bell remains the delivery of record.
 */
export function PwaRegister(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  }, []);

  return null;
}
