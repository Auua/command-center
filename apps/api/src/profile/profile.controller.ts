import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateProfileRequestSchema, type Profile } from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileService } from './profile.service';

/**
 * /api/v1/profile — the user's stored home timezone (Q1). GET 404s until the
 * first PUT (upsert); the web app auto-captures the browser timezone on
 * first authed load (plan D4).
 */
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<Profile> {
    return this.profileService.getProfile(user);
  }

  @Put()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<Profile> {
    const request = UpdateProfileRequestSchema.parse(body);
    return this.profileService.updateProfile(user, request);
  }
}
