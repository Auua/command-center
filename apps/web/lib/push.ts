import { PushSubscriptionRequestSchema } from '@command-center/contracts';
import { getVapidPublicKey } from '@/lib/env';
import { supportsPush } from '@/lib/pwa';
import { savePushSubscription } from '@/lib/notifications-api';

/**
 * Web Push client (Phase 2 plan §4). Two entry points, both browser-only:
 *
 * - subscribeToPush() — the permission-banner button's ONLY call site; the
 *   single place Notification.requestPermission() is invoked (ADR-015:
 *   permission on explicit gesture, never on load).
 * - reconcileSubscription() — on app open, iff permission is already granted:
 *   re-subscribes (no prompt) and re-upserts to the server, healing endpoint
 *   rotation. Best-effort; D2 dropped the pushsubscriptionchange endpoint.
 */

export type SubscribeResult =
  | { status: 'subscribed' }
  | { status: 'denied' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** Web Push wants the VAPID key as a Uint8Array, not URL-safe base64. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Subscribe this browser and upsert the subscription to the API. */
async function subscribeAndSave(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()),
  });
  // The contract schema is the source of truth for the wire shape; parsing
  // also strips any extra fields a browser adds to toJSON().
  const request = PushSubscriptionRequestSchema.parse(subscription.toJSON());
  await savePushSubscription(request);
}

/**
 * Request permission (browser prompt) and subscribe. Call ONLY from the
 * banner's "Enable notifications" button.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!supportsPush()) {
    return { status: 'unsupported' };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { status: 'denied' };
    }
    await subscribeAndSave();
    return { status: 'subscribed' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Heal this browser's subscription on app open — permission already granted
 * means subscribe() never prompts. Swallows failures: reminders still land
 * in the bell, and the next open retries.
 */
export async function reconcileSubscription(): Promise<void> {
  if (!supportsPush() || Notification.permission !== 'granted') {
    return;
  }
  try {
    await subscribeAndSave();
  } catch {
    // Best-effort by design (D2).
  }
}
