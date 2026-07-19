import { Injectable, NotFoundException } from '@nestjs/common';
import type { Profile, UpdateProfileRequest } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileRepository } from './profile.repository';

/** Fallback when no profile row exists yet (plan D4: the client auto-upserts
 * the browser timezone on first authed load; until then, UTC). */
export const DEFAULT_TIMEZONE = 'UTC';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  /**
   * 404 when no profile row exists — the client's cue to auto-capture the
   * browser timezone (D4). Callers that just need *a* timezone use
   * getTimezone below.
   */
  async getProfile(user: AuthenticatedUser): Promise<Profile> {
    const timezone = await this.profileRepository.getTimezoneForUser(user);
    if (timezone === null) {
      throw new NotFoundException('No profile yet');
    }
    return { timezone };
  }

  async updateProfile(user: AuthenticatedUser, request: UpdateProfileRequest): Promise<Profile> {
    const timezone = await this.profileRepository.upsertTimezoneForUser(user, request.timezone);
    return { timezone };
  }

  /** The user's home timezone, defaulting to UTC before first capture. */
  async getTimezone(user: AuthenticatedUser): Promise<string> {
    return (await this.profileRepository.getTimezoneForUser(user)) ?? DEFAULT_TIMEZONE;
  }
}
