import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Public liveness probe. Imports SchedulerModule only for the tick-staleness
 * read (NFR-10, ADR-039) — the service-role client stays confined to
 * SchedulerRepository.
 */
@Module({
  imports: [SchedulerModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
