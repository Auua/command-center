import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { DispatchService } from './dispatch.service';
import { SchedulerRepository } from './scheduler.repository';
import { SchedulerService } from './scheduler.service';
import { TickController } from './tick.controller';
import { TickSecretGuard } from './tick.guard';

/**
 * SchedulerModule (ADR-039): the inline tick — controller (secret-guarded,
 * non-JWT), service (cursor window → evaluate → claim → dispatch → advance),
 * and the ONLY service-role Supabase consumer (SchedulerRepository).
 *
 * Exports:
 * - DispatchService — AutomationModule's task-completed listener dispatches
 *   event automations through the same claim → bell → push tail.
 * - SchedulerRepository — HealthModule reads scheduler_state for the
 *   /health tick-staleness field (NFR-10); the repository stays the single
 *   holder of the service-role client.
 */
@Module({
  imports: [NotificationModule],
  controllers: [TickController],
  providers: [SchedulerService, SchedulerRepository, DispatchService, TickSecretGuard],
  exports: [DispatchService, SchedulerRepository],
})
export class SchedulerModule {}
