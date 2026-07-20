import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AutomationController } from './automation.controller';
import { AutomationRepository } from './automation.repository';
import { AutomationService } from './automation.service';
import { TaskCompletedListener } from './task-completed.listener';

/**
 * AutomationModule (ADR §4.1 core module, ADR-015): owns `automations`
 * (user-facing; `automation_runs` rows are written by the scheduler's
 * service-role path and only read here). Exposes CRUD + the widget read
 * model, compiles schedule → cron_expr as the single write path, and hosts
 * the task-completed listener that feeds event automations into
 * SchedulerModule's shared dispatch tail. ProfileModule supplies the stored
 * timezone for today-expansion (Q1).
 */
@Module({
  imports: [SupabaseModule, ProfileModule, SchedulerModule],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationRepository, TaskCompletedListener],
})
export class AutomationModule {}
