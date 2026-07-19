import { z } from 'zod';

/**
 * Notifications — Web Push subscriptions + the in-app bell (ADR §4.4
 * `push_subscriptions` / `notifications`, ADR-039; owned by
 * NotificationModule). The bell row is the delivery of record: every
 * automation fire lands here whether or not any push was accepted.
 */

/**
 * Known browser push-service hosts. Web Push means the server POSTs
 * VAPID-signed requests to the client-supplied endpoint, so an unvalidated
 * endpoint is an SSRF vector — anything off this allowlist is rejected at the
 * contract layer (ADR-039).
 */
export const PUSH_ENDPOINT_ALLOWED_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome / Chromium (FCM)
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox (autopush)
  /(^|\.)push\.apple\.com$/, // Safari / iOS installed PWA
  /(^|\.)notify\.windows\.com$/, // Edge on Windows (WNS)
];

// The WHATWG URL global exists in every runtime the contracts target
// (browsers, Node ≥ 10), but the platform-neutral ES lib doesn't type it —
// declare the sliver this module uses instead of pulling in lib.dom.
interface ParsedUrl {
  protocol: string;
  port: string;
  hostname: string;
  username: string;
  password: string;
}
declare const URL: new (input: string) => ParsedUrl;

/** True iff the endpoint is HTTPS on a known push-service host (no explicit port). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: ParsedUrl;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    PUSH_ENDPOINT_ALLOWED_HOSTS.some((host) => host.test(url.hostname))
  );
}

const EndpointSchema = z.string().min(1).max(1024);

/**
 * POST /notifications/subscriptions — the browser `PushSubscription.toJSON()`
 * shape, forwarded verbatim by the client. Upserted on (user, endpoint).
 */
export const PushSubscriptionRequestSchema = z
  .object({
    endpoint: EndpointSchema.refine(isAllowedPushEndpoint, {
      message: 'endpoint must be an HTTPS URL on a known browser push service',
    }),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(256),
        auth: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>;

/** DELETE /notifications/subscriptions — unsubscribe this browser's endpoint. */
export const DeletePushSubscriptionRequestSchema = z
  .object({
    endpoint: EndpointSchema,
  })
  .strict();
export type DeletePushSubscriptionRequest = z.infer<typeof DeletePushSubscriptionRequestSchema>;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().nullable(),
  /** Producing feature — 'automation' today; future sources aren't automations. */
  source: z.string().min(1),
  automationId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** GET /notifications?limit=20 → newest first + the unread badge count (D5). */
export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int().min(0),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

/** `?limit=` for GET /notifications. */
export const NotificationsLimitSchema = z.coerce.number().int().min(1).max(100).default(20);

/**
 * POST /notifications/read — exactly one of `ids` (specific rows) or
 * `all: true` (opening the panel marks everything read, D5).
 */
export const MarkNotificationsReadRequestSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => (value.ids !== undefined) !== (value.all !== undefined), {
    message: 'Provide exactly one of ids or all',
  });
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequestSchema>;

export const MarkNotificationsReadResponseSchema = z.object({
  unreadCount: z.number().int().min(0),
});
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponseSchema>;
