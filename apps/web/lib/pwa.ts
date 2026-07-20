/**
 * PWA environment guards (Phase 2 plan §4). All return false during
 * SSR/prerender — call them client-side (effects, event handlers) only.
 * They feed derivePermissionUx() in the reminders widget: iOS grants push
 * only to installed (standalone) PWAs.
 */

/** True when running as an installed app (Home Screen / installed PWA). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari's non-standard flag, set when launched from the Home Screen.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True on iPhone/iPad/iPod, including iPadOS 13+ masquerading as macOS. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS reports as Macintosh; Macs have no touch screen.
  return navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

/** True when the browser exposes the whole Web Push stack. */
export function supportsPush(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
