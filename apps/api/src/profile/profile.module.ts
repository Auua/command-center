import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProfileController } from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

/**
 * ProfileModule (Phase 2): owns `user_profiles` exclusively. Exports
 * ProfileService so AutomationModule's today endpoint can resolve the
 * user's home timezone without touching the table (module ownership rule,
 * ADR-002).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService],
})
export class ProfileModule {}
