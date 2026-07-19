import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  MarkNotificationsReadRequestSchema,
  NotificationsLimitSchema,
  type MarkNotificationsReadResponse,
  type NotificationListResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from './notification.service';

/**
 * /api/v1/notifications — the in-app bell (plan D5): newest-first list with
 * the unread badge count; opening the panel POSTs read. The bell row is the
 * delivery of record for every automation fire (ADR-039).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  listNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<NotificationListResponse> {
    return this.notificationService.listNotifications(user, NotificationsLimitSchema.parse(limit));
  }

  @Post('read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<MarkNotificationsReadResponse> {
    const request = MarkNotificationsReadRequestSchema.parse(body);
    return this.notificationService.markRead(user, request);
  }
}
