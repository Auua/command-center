import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CalendarController } from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

/**
 * CalendarModule (ADR-018): own events and recurring series, expanded per
 * request (`expansion.ts`). Owns `calendar_events` exclusively (ADR-002);
 * reads the home timezone through ProfileModule's exported service. Emits
 * and listens to no domain events in v1; task deadlines are overlaid by the
 * web client from `GET /tasks`, never imported here.
 */
@Module({
  imports: [SupabaseModule, ProfileModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarRepository],
})
export class CalendarModule {}
