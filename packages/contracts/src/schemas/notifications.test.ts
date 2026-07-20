import { describe, expect, it } from 'vitest';
import {
  DeletePushSubscriptionRequestSchema,
  isAllowedPushEndpoint,
  MarkNotificationsReadRequestSchema,
  NotificationListResponseSchema,
  NotificationSchema,
  NotificationsLimitSchema,
  PushSubscriptionRequestSchema,
} from './notifications';

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123:def456';

const SUBSCRIPTION = {
  endpoint: FCM_ENDPOINT,
  expirationTime: null,
  keys: { p256dh: 'BPq5-key-material', auth: 'auth-secret' },
};

const NOTIFICATION = {
  id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
  title: 'Hydration break',
  body: 'Drink some water',
  source: 'automation',
  automationId: '2b1c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8',
  createdAt: '2026-07-19T12:00:02.000Z',
  readAt: null,
};

describe('isAllowedPushEndpoint', () => {
  it.each([
    FCM_ENDPOINT,
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/QOsWr4nc',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('accepts the known push host %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['arbitrary https host (SSRF)', 'https://internal.example.com/hook'],
    ['host suffix trick', 'https://fcm.googleapis.com.evil.example/x'],
    ['prefix trick', 'https://evilfcm.googleapis.com.evil.example/x'],
    ['explicit port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['credentials in URL', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['localhost', 'https://localhost/push'],
    ['not a URL', 'not-a-url'],
  ])('rejects %s', (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('PushSubscriptionRequestSchema', () => {
  it('accepts the browser PushSubscription.toJSON() shape', () => {
    expect(PushSubscriptionRequestSchema.parse(SUBSCRIPTION)).toEqual(SUBSCRIPTION);
  });

  it('accepts a subscription without expirationTime', () => {
    const { expirationTime: _omitted, ...rest } = SUBSCRIPTION;
    expect(PushSubscriptionRequestSchema.safeParse(rest).success).toBe(true);
  });

  it.each([
    ['disallowed endpoint host', { ...SUBSCRIPTION, endpoint: 'https://evil.example/hook' }],
    ['missing keys', { endpoint: FCM_ENDPOINT }],
    ['empty p256dh', { ...SUBSCRIPTION, keys: { p256dh: '', auth: 'a' } }],
    ['unknown key field', { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, extra: 'x' } }],
    ['unknown top-level field', { ...SUBSCRIPTION, userId: 'someone-else' }],
  ])('rejects %s', (_label, value) => {
    expect(PushSubscriptionRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe('DeletePushSubscriptionRequestSchema', () => {
  it('accepts any endpoint string (deleting your own row is harmless)', () => {
    expect(
      DeletePushSubscriptionRequestSchema.safeParse({ endpoint: 'https://anything.example/x' })
        .success,
    ).toBe(true);
    expect(DeletePushSubscriptionRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('NotificationSchema / list response', () => {
  it('accepts a bell row and the {items, unreadCount} envelope (D5)', () => {
    expect(NotificationSchema.parse(NOTIFICATION)).toEqual(NOTIFICATION);
    expect(NotificationListResponseSchema.parse({ items: [NOTIFICATION], unreadCount: 1 })).toEqual(
      { items: [NOTIFICATION], unreadCount: 1 },
    );
  });

  it('accepts a read, body-less, source-detached notification', () => {
    const read = {
      ...NOTIFICATION,
      body: null,
      automationId: null,
      readAt: '2026-07-19T12:30:00.000Z',
    };
    expect(NotificationSchema.parse(read)).toEqual(read);
  });

  it('rejects a negative unreadCount', () => {
    expect(NotificationListResponseSchema.safeParse({ items: [], unreadCount: -1 }).success).toBe(
      false,
    );
  });
});

describe('NotificationsLimitSchema', () => {
  it('defaults to 20 and coerces strings', () => {
    expect(NotificationsLimitSchema.parse(undefined)).toBe(20);
    expect(NotificationsLimitSchema.parse('50')).toBe(50);
  });

  it.each(['abc', '0', '101'])('rejects %s', (value) => {
    expect(NotificationsLimitSchema.safeParse(value).success).toBe(false);
  });
});

describe('MarkNotificationsReadRequestSchema', () => {
  it('accepts exactly one of ids or all', () => {
    expect(MarkNotificationsReadRequestSchema.safeParse({ ids: [NOTIFICATION.id] }).success).toBe(
      true,
    );
    expect(MarkNotificationsReadRequestSchema.safeParse({ all: true }).success).toBe(true);
  });

  it.each([
    ['neither', {}],
    ['both', { ids: [NOTIFICATION.id], all: true }],
    ['all: false', { all: false }],
    ['empty ids', { ids: [] }],
    ['non-uuid ids', { ids: ['42'] }],
  ])('rejects %s', (_label, value) => {
    expect(MarkNotificationsReadRequestSchema.safeParse(value).success).toBe(false);
  });
});
