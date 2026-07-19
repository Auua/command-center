import 'reflect-metadata';
import type { Notification } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotificationRepository, SubscriptionValues } from './notification.repository';
import { NotificationService } from './notification.service';

const ANNA: AuthenticatedUser = { id: 'user-1', token: 'jwt' };

const NOTIFICATION: Notification = {
  id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
  title: 'Hydration break',
  body: null,
  source: 'automation',
  automationId: null,
  createdAt: '2026-07-19T12:00:02.000Z',
  readAt: null,
};

class FakeNotificationRepository {
  items: Notification[] = [];
  unread = 0;
  markReadCalls: (string[] | 'all')[] = [];
  subscriptions: SubscriptionValues[] = [];
  deletedEndpoints: string[] = [];

  listForUser(): Promise<Notification[]> {
    return Promise.resolve(this.items);
  }

  countUnreadForUser(): Promise<number> {
    return Promise.resolve(this.unread);
  }

  markReadForUser(_user: AuthenticatedUser, ids: string[] | 'all'): Promise<void> {
    this.markReadCalls.push(ids);
    this.unread = 0;
    return Promise.resolve();
  }

  upsertSubscriptionForUser(_user: AuthenticatedUser, values: SubscriptionValues): Promise<void> {
    this.subscriptions.push(values);
    return Promise.resolve();
  }

  deleteSubscriptionForUser(_user: AuthenticatedUser, endpoint: string): Promise<void> {
    this.deletedEndpoints.push(endpoint);
    return Promise.resolve();
  }
}

describe('NotificationService', () => {
  let repository: FakeNotificationRepository;
  let service: NotificationService;

  beforeEach(() => {
    repository = new FakeNotificationRepository();
    service = new NotificationService(repository as unknown as NotificationRepository);
  });

  it('lists notifications with the unread badge count (D5)', async () => {
    repository.items = [NOTIFICATION];
    repository.unread = 3;

    await expect(service.listNotifications(ANNA, 20)).resolves.toEqual({
      items: [NOTIFICATION],
      unreadCount: 3,
    });
  });

  it('marks specific ids read and returns the fresh unread count', async () => {
    repository.unread = 2;

    await expect(service.markRead(ANNA, { ids: [NOTIFICATION.id] })).resolves.toEqual({
      unreadCount: 0,
    });
    expect(repository.markReadCalls).toEqual([[NOTIFICATION.id]]);
  });

  it('marks the whole inbox read for { all: true }', async () => {
    await service.markRead(ANNA, { all: true });
    expect(repository.markReadCalls).toEqual(['all']);
  });

  it('flattens the browser subscription shape into subscription values', async () => {
    await service.subscribe(
      ANNA,
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
      },
      'Mozilla/5.0',
    );

    expect(repository.subscriptions).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        p256dh: 'p',
        auth: 'a',
        userAgent: 'Mozilla/5.0',
      },
    ]);
  });

  it('unsubscribes by endpoint', async () => {
    await service.unsubscribe(ANNA, 'https://fcm.googleapis.com/fcm/send/abc');
    expect(repository.deletedEndpoints).toEqual(['https://fcm.googleapis.com/fcm/send/abc']);
  });
});
