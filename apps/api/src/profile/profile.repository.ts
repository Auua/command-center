import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'user_profiles';

/**
 * Persistence for user profiles (ADR §4.4 `user_profiles`; Phase 2 needs
 * exactly the stored home timezone, Q1). RLS-scoped like every user-facing
 * repository — the caller's own JWT, never the service role (ADR §5.1).
 */
@Injectable()
export class ProfileRepository {
  private readonly logger = new Logger(ProfileRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Returns the stored timezone, or null when no profile row exists yet. */
  async getTimezoneForUser(user: AuthenticatedUser): Promise<string | null> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select('timezone')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to read profile: ${error.message}`);
      throw new InternalServerErrorException('Failed to read profile');
    }
    return (data as { timezone: string } | null)?.timezone ?? null;
  }

  async upsertTimezoneForUser(user: AuthenticatedUser, timezone: string): Promise<string> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .upsert({ user_id: user.id, timezone }, { onConflict: 'user_id' })
      .select('timezone')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to upsert profile: ${error?.message}`);
      throw new InternalServerErrorException('Failed to update profile');
    }
    return (data as { timezone: string }).timezone;
  }
}
