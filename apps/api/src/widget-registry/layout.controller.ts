import { Body, Controller, Get, Put } from '@nestjs/common';
import { PutLayoutRequestSchema, type LayoutResponse } from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LayoutService } from './layout.service';

/**
 * Reject unknown top-level fields on the write path (ADR §5.2
 * reject-unknown-fields). Nested item fields are governed by the shared
 * contract schema, which strips unknown keys.
 */
const PutLayoutRequestStrictSchema = PutLayoutRequestSchema.strict();

/**
 * /api/v1/layout — dashboard layout persistence (ADR §4.2, §4.5).
 * Validation is explicit zod `.parse` (ZodErrors become 400s via the global
 * ZodExceptionFilter); the user always comes from the verified JWT.
 */
@Controller('layout')
export class LayoutController {
  constructor(private readonly layoutService: LayoutService) {}

  @Get()
  getLayout(@CurrentUser() user: AuthenticatedUser): Promise<LayoutResponse> {
    return this.layoutService.getLayout(user);
  }

  @Put()
  putLayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<LayoutResponse> {
    const request = PutLayoutRequestStrictSchema.parse(body);
    return this.layoutService.putLayout(user, request);
  }
}
