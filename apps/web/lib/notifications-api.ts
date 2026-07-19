import {
  MarkNotificationsReadResponseSchema,
  NotificationListResponseSchema,
  type MarkNotificationsReadRequest,
  type MarkNotificationsReadResponse,
  type NotificationListResponse,
  type PushSubscriptionRequest,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Client for /api/v1/notifications (NotificationModule): the in-app bell —
 * the delivery of record (ADR-039) — and this browser's push subscription.
 */

export async function fetchNotifications(limit = 20): Promise<NotificationListResponse> {
  const response = await apiFetch(`/api/v1/notifications?limit=${limit}`);
  return NotificationListResponseSchema.parse(await response.json());
}

/** D5: opening the panel marks everything read (`{ all: true }`). */
export async function markNotificationsRead(
  request: MarkNotificationsReadRequest,
): Promise<MarkNotificationsReadResponse> {
  const response = await apiFetch('/api/v1/notifications/read', {
    method: 'POST',
    body: request,
  });
  return MarkNotificationsReadResponseSchema.parse(await response.json());
}

/** Upserts this browser's subscription on (user, endpoint). */
export async function savePushSubscription(subscription: PushSubscriptionRequest): Promise<void> {
  await apiFetch('/api/v1/notifications/subscriptions', {
    method: 'POST',
    body: subscription,
  });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await apiFetch('/api/v1/notifications/subscriptions', {
    method: 'DELETE',
    body: { endpoint },
  });
}
