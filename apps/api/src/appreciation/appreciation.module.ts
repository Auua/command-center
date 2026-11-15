import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AppreciationController } from './appreciation.controller';
import { AppreciationRepository } from './appreciation.repository';
import { AppreciationService } from './appreciation.service';

/**
 * AppreciationModule (ADR-017): one-line appreciations and the seeded daily
 * prompts. Owns `appreciation_entries` and `appreciation_prompts`
 * exclusively (module ownership rule, ADR-002); reads the home timezone
 * through ProfileModule's exported service, never its table.
 */
@Module({
  imports: [SupabaseModule, ProfileModule],
  controllers: [AppreciationController],
  providers: [AppreciationService, AppreciationRepository],
})
export class AppreciationModule {}
