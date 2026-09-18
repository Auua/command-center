import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  GrammarActionRequestSchema,
  GrammarCeilingSchema,
  WotdActionRequestSchema,
  WotdCeilingSchema,
  type AnkiStatusResponse,
  type GrammarResponse,
  type VaultStatusResponse,
  type WotdResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AnkiStatusService } from './anki/anki-status.service';
import { GrammarService } from './grammar/grammar.service';
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
    private readonly grammarService: GrammarService,
    private readonly learningService: LearningService,
    private readonly ankiStatusService: AnkiStatusService,
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

  @Get('grammar/today')
  getGrammar(
    @CurrentUser() user: AuthenticatedUser,
    @Query('ceiling') ceiling?: string,
  ): Promise<GrammarResponse> {
    return this.grammarService.getToday(user, GrammarCeilingSchema.parse(ceiling));
  }

  @Post('grammar/advance')
  advanceGrammar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Query('ceiling') ceiling?: string,
  ): Promise<GrammarResponse> {
    const request = GrammarActionRequestSchema.parse(body);
    return this.grammarService.advance(user, GrammarCeilingSchema.parse(ceiling), request.itemId);
  }

  @Post('grammar/studied')
  grammarStudied(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Query('ceiling') ceiling?: string,
  ): Promise<GrammarResponse> {
    const request = GrammarActionRequestSchema.parse(body);
    return this.grammarService.studied(user, GrammarCeilingSchema.parse(ceiling), request.itemId);
  }

  @Get('anki-status')
  ankiStatus(@CurrentUser() user: AuthenticatedUser): Promise<AnkiStatusResponse> {
    return this.ankiStatusService.status(user);
  }

  @Get('vault-status')
  vaultStatus(@CurrentUser() user: AuthenticatedUser): Promise<VaultStatusResponse> {
    return this.learningService.vaultStatus(user);
  }
}
