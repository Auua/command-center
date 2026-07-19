import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { WebPushService } from './web-push.service';

/**
 * NotificationModule (ADR §4.1 core module): owns `notifications` and
 * `push_subscriptions`. Exports WebPushService for the scheduler's dispatch
 * tail (SchedulerModule) — sending is stateless; every row this module owns
 * is written user-scoped here or via the scheduler's service-role carve-out
 * (ADR-039).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [NotificationsController, SubscriptionsController],
  providers: [NotificationService, NotificationRepository, WebPushService],
  exports: [WebPushService],
})
export class NotificationModule {}
