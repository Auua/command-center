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
  AppreciationListLimitSchema,
  AppreciationPromptLocaleSchema,
  CreateAppreciationRequestSchema,
  type AppreciationEntry,
  type AppreciationExport,
  type AppreciationListResponse,
  type AppreciationPromptToday,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppreciationService } from './appreciation.service';

/**
 * /api/v1/appreciation — the appreciation tracker (ADR-017). Validation is
 * explicit zod `.parse` (ZodErrors become 400s via the global filter);
 * the user always comes from the verified JWT. No PATCH: entries are
 * one-liners — edit is delete + re-add.
 */
@Controller('appreciation')
export class AppreciationController {
  constructor(private readonly service: AppreciationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<AppreciationListResponse> {
    return this.service.list(user, AppreciationListLimitSchema.parse(limit));
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<AppreciationEntry> {
    return this.service.create(user, CreateAppreciationRequestSchema.parse(body));
  }

  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser): Promise<AppreciationExport> {
    return this.service.export(user);
  }

  @Get('prompts/today')
  promptToday(
    @CurrentUser() user: AuthenticatedUser,
    @Query('locale') locale?: string,
  ): Promise<AppreciationPromptToday> {
    return this.service.promptToday(user, AppreciationPromptLocaleSchema.parse(locale));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.delete(user, id);
  }
}
