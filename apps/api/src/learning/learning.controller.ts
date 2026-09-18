import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  WotdActionRequestSchema,
  WotdCeilingSchema,
  type VaultStatusResponse,
  type WotdResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LearningService } from './learning.service';
import { WotdService } from './wotd/wotd.service';

/**
 * /api/v1/learning — the vault-backed learning surface (ADR-024/040).
 * Validation is explicit zod `.parse` (ZodErrors → 400 via the global
 * filter); the ceiling rides the request from the widget's own settings.
 */
@Controller('learning')
export class LearningController {
  constructor(
    private readonly wotdService: WotdService,
    private readonly learningService: LearningService,
  ) {}

  @Get('wotd')
  getWotd(
    @CurrentUser() user: AuthenticatedUser,
    @Query('ceiling') ceiling?: string,
  ): Promise<WotdResponse> {
    return this.wotdService.getToday(user, WotdCeilingSchema.parse(ceiling));
  }

  @Post('wotd/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<WotdResponse> {
    const request = WotdActionRequestSchema.parse(body);
    return this.wotdService.acknowledge(user, request.itemId);
  }

  @Post('wotd/skip')
  skip(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Query('ceiling') ceiling?: string,
  ): Promise<WotdResponse> {
    const request = WotdActionRequestSchema.parse(body);
    return this.wotdService.skip(user, WotdCeilingSchema.parse(ceiling), request.itemId);
  }

  @Get('vault-status')
  vaultStatus(@CurrentUser() user: AuthenticatedUser): Promise<VaultStatusResponse> {
    return this.learningService.vaultStatus(user);
  }
}
