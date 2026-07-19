import { Body, Controller, Delete, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  DeletePushSubscriptionRequestSchema,
  PushSubscriptionRequestSchema,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from './notification.service';

/**
 * /api/v1/notifications/subscriptions — Web Push subscription registration.
 * POST upserts on (user, endpoint) — re-registering the same browser is a
 * no-op; DELETE (body: { endpoint }) unsubscribes idempotently. The contract
 * rejects endpoints off the known push-service host allowlist (ADR-039:
 * SSRF closed at registration).
 */
@Controller('notifications/subscriptions')
export class SubscriptionsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    const request = PushSubscriptionRequestSchema.parse(body);
    await this.notificationService.subscribe(user, request, userAgent?.slice(0, 512) ?? null);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<void> {
    const request = DeletePushSubscriptionRequestSchema.parse(body);
    await this.notificationService.unsubscribe(user, request.endpoint);
  }
}
