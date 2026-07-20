import { Injectable } from '@nestjs/common';
import type {
  MarkNotificationsReadRequest,
  MarkNotificationsReadResponse,
  NotificationListResponse,
  PushSubscriptionRequest,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationRepository } from './notification.repository';

/**
 * Bell + subscription rules (ADR-039, plan D5). Dispatch — writing bell rows
 * and sending pushes — lives in the scheduler's dispatch tail, not here:
 * this service is the user-facing read/manage surface.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async listNotifications(
    user: AuthenticatedUser,
    limit: number,
  ): Promise<NotificationListResponse> {
    const [items, unreadCount] = await Promise.all([
      this.notificationRepository.listForUser(user, limit),
      this.notificationRepository.countUnreadForUser(user),
    ]);
    return { items, unreadCount };
  }

  async markRead(
    user: AuthenticatedUser,
    request: MarkNotificationsReadRequest,
  ): Promise<MarkNotificationsReadResponse> {
    // The contract requires `all` or `ids`; if neither survives, an empty
    // list is a harmless no-op rather than an asserted crash.
    await this.notificationRepository.markReadForUser(
      user,
      request.all ? 'all' : (request.ids ?? []),
    );
    const unreadCount = await this.notificationRepository.countUnreadForUser(user);
    return { unreadCount };
  }

  async subscribe(
    user: AuthenticatedUser,
    request: PushSubscriptionRequest,
    userAgent: string | null,
  ): Promise<void> {
    await this.notificationRepository.upsertSubscriptionForUser(user, {
      endpoint: request.endpoint,
      p256dh: request.keys.p256dh,
      auth: request.keys.auth,
      userAgent,
    });
  }

  async unsubscribe(user: AuthenticatedUser, endpoint: string): Promise<void> {
    await this.notificationRepository.deleteSubscriptionForUser(user, endpoint);
  }
}
