import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateJournalEntryRequestSchema,
  JournalListQuerySchema,
  JournalPromptCategoriesQuerySchema,
  JournalPromptLocaleSchema,
  PatchJournalEntryRequestSchema,
  type JournalEntry,
  type JournalExport,
  type JournalListResponse,
  type JournalToday,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JournalService } from './journal.service';

/**
 * /api/v1/journal — the journal (ADR-016). Validation is explicit zod
 * `.parse` (ZodErrors become 400s via the global filter); the user always
 * comes from the verified JWT. The doc is validated against the contract's
 * allowlist on every write.
 */
@Controller('journal')
export class JournalController {
  constructor(private readonly service: JournalService) {}

  @Get('today')
  today(
    @CurrentUser() user: AuthenticatedUser,
    @Query('locale') locale?: string,
    @Query('categories') categories?: string,
  ): Promise<JournalToday> {
    return this.service.today(
      user,
      JournalPromptLocaleSchema.parse(locale),
      JournalPromptCategoriesQuerySchema.parse(categories),
    );
  }

  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser): Promise<JournalExport> {
    return this.service.export(user);
  }

  @Get('entries')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ): Promise<JournalListResponse> {
    return this.service.list(user, JournalListQuerySchema.parse(query));
  }

  @Get('entries/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<JournalEntry> {
    return this.service.get(user, id);
  }

  @Post('entries')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<JournalEntry> {
    return this.service.create(user, CreateJournalEntryRequestSchema.parse(body));
  }

  @Patch('entries/:id')
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<JournalEntry> {
    return this.service.patch(user, id, PatchJournalEntryRequestSchema.parse(body));
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.delete(user, id);
  }
}
