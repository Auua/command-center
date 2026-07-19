/* Command Center service worker.
 *
 * Push + notification handling only — deliberately NO fetch handler:
 * offline is an explicit non-goal (ADR §1.3), and installability no longer
 * requires one. Served with Cache-Control: no-store (next.config.ts) so a
 * new deploy's worker is picked up on the next load.
 *
 * Expected push payload (best-effort JSON from the API):
 *   { title, body?, notificationId?, automationId?, slot? }
 * Every field is treated as optional — a malformed payload still surfaces
 * a generic notification instead of throwing inside the push event.
 */

const FALLBACK_TITLE = 'Command Center';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(event) {
  if (!event.data) return {};
  try {
    const parsed = event.data.json();
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event);
  const title = typeof payload.title === 'string' && payload.title ? payload.title : FALLBACK_TITLE;
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      notificationId: typeof payload.notificationId === 'string' ? payload.notificationId : null,
    },
  };
  // OS-level dedupe: delivery is at-least-once, so the same slot may be
  // pushed twice — an identical tag replaces rather than duplicates.
  if (typeof payload.automationId === 'string' && typeof payload.slot === 'string') {
    options.tag = `${payload.automationId}:${payload.slot}`;
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Let open tabs react immediately (e.g. refetch the notification bell).
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: 'cc:push', payload });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const notificationId =
    data && typeof data.notificationId === 'string' ? data.notificationId : null;
  const url = notificationId ? `/?notification=${encodeURIComponent(notificationId)}` : '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientList.find((client) => 'focus' in client);
      if (existing) {
        // Focus the open app and deep-link in-app (no full reload).
        await existing.focus();
        existing.postMessage({ type: 'cc:notification-click', notificationId });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // D2: no rotation endpoint in v1. Best-effort local re-subscribe keeps the
  // browser subscription alive; reconcileSubscription() on next app open
  // syncs the server (permission already granted, so no prompt).
  const oldSubscription = event.oldSubscription;
  if (!oldSubscription || !oldSubscription.options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(oldSubscription.options).catch(() => undefined),
  );
});
