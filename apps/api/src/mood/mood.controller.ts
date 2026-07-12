import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateMoodCheckinRequestSchema,
  MoodWindowDaysSchema,
  type MoodCheckin,
  type MoodCheckinListResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MoodService } from './mood.service';

/**
 * /api/v1/mood — mood check-ins (ARD §4.1 MoodModule). Validation is
 * explicit zod `.parse` (ZodErrors become 400s via the global
 * ZodExceptionFilter); unknown-field rejection is baked into the write
 * schema. The user always comes from the verified JWT.
 *
 * No PATCH: check-ins are immutable — log a new one, or DELETE to undo.
 */
@Controller('mood')
export class MoodController {
  constructor(private readonly moodService: MoodService) {}

  @Get()
  listCheckins(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ): Promise<MoodCheckinListResponse> {
    return this.moodService.listCheckins(user, MoodWindowDaysSchema.parse(days));
  }

  @Post()
  createCheckin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<MoodCheckin> {
    const request = CreateMoodCheckinRequestSchema.parse(body);
    return this.moodService.createCheckin(user, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCheckin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.moodService.deleteCheckin(user, id);
  }
}
