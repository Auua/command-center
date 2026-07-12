import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

/**
 * TasksModule (ARD §4.1): first Postgres-backed domain module — validates
 * the relational half of ADR-003. Owns the `tasks` table exclusively; no
 * other module may touch it (module ownership rule, ADR-002). Cross-domain
 * reactions leave via the `task.completed` event, never via imports.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [TasksController],
  providers: [TasksService, TasksRepository],
})
export class TasksModule {}
