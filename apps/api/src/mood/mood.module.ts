import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { MoodController } from './mood.controller';
import { MoodRepository } from './mood.repository';
import { MoodService } from './mood.service';

/**
 * MoodModule (ADR §4.1): mood check-ins + the data behind the trend chart.
 * Owns the `mood_checkins` table exclusively; no other module may touch it
 * (module ownership rule, ADR-002).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [MoodController],
  providers: [MoodService, MoodRepository],
})
export class MoodModule {}
