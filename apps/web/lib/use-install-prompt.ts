'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Chromium's non-standard install event (absent from lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

/**
 * Captures Chromium's `beforeinstallprompt` so the app can offer its own
 * install affordance. The browser prompt is NEVER auto-fired: the captured
 * event is stashed until promptInstall() is invoked from an explicit user
 * gesture (Phase 2 plan §4). iOS has no such event — its path is the static
 * "Install to Home Screen" hint (isIos()/isStandalone() in lib/pwa.ts).
 */
export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall: () => Promise<InstallPromptOutcome>;
} {
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event): void => {
      // Suppress the browser's mini-infobar; keep the event for later.
      event.preventDefault();
      deferredRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onAppInstalled = (): void => {
      deferredRef.current = null;
      setCanInstall(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return (): void => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallPromptOutcome> => {
    const deferred = deferredRef.current;
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const choice = await deferred.userChoice;
    // The event is single-use; a new beforeinstallprompt may arrive later.
    deferredRef.current = null;
    setCanInstall(false);
    return choice.outcome;
  }, []);

  return { canInstall, promptInstall };
}
