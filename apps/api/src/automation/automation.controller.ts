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
  AutomationRunsLimitSchema,
  CreateAutomationRequestSchema,
  UpdateAutomationRequestSchema,
  type Automation,
  type AutomationListResponse,
  type AutomationRunListResponse,
  type AutomationTemplateListResponse,
  type TodayResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AutomationService } from './automation.service';

/**
 * /api/v1/automations — CRUD + the widget read model (ADR-015). Validation
 * is explicit zod `.parse` (ZodErrors → 400 via the global filter); the
 * user always comes from the verified JWT.
 */
@Controller('automations')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get()
  listAutomations(@CurrentUser() user: AuthenticatedUser): Promise<AutomationListResponse> {
    return this.automationService.listAutomations(user);
  }

  @Get('today')
  getToday(@CurrentUser() user: AuthenticatedUser): Promise<TodayResponse> {
    return this.automationService.getToday(user);
  }

  @Get('templates')
  getTemplates(): AutomationTemplateListResponse {
    return this.automationService.getTemplates();
  }

  @Get(':id/runs')
  listRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<AutomationRunListResponse> {
    return this.automationService.listRuns(user, id, AutomationRunsLimitSchema.parse(limit));
  }

  @Post()
  createAutomation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Automation> {
    const request = CreateAutomationRequestSchema.parse(body);
    return this.automationService.createAutomation(user, request);
  }

  @Patch(':id')
  updateAutomation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Automation> {
    const request = UpdateAutomationRequestSchema.parse(body);
    return this.automationService.updateAutomation(user, id, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAutomation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.automationService.deleteAutomation(user, id);
  }
}
