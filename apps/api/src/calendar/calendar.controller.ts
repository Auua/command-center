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
  CalendarEventWriteSchema,
  CalendarRangeQuerySchema,
  type CalendarEvent,
  type CalendarRangeResponse,
} from '@command-center/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CalendarService } from './calendar.service';

/**
 * /api/v1/calendar — own events and recurring series (ADR-018). Validation
 * is explicit zod `.parse` (ZodErrors become 400s via the global filter);
 * the user always comes from the verified JWT.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  /** Expanded occurrences in [from, to), dates in the home timezone. */
  @Get('events')
  range(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ): Promise<CalendarRangeResponse> {
    return this.service.range(user, CalendarRangeQuerySchema.parse(query));
  }

  /** The stored event or series (with its rule) — for the edit dialog. */
  @Get('events/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CalendarEvent> {
    return this.service.get(user, id);
  }

  @Post('events')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<CalendarEvent> {
    return this.service.create(user, CalendarEventWriteSchema.parse(body));
  }

  /** Edit the event, or the whole series: the body is the full event. */
  @Patch('events/:id')
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CalendarEvent> {
    return this.service.replace(user, id, CalendarEventWriteSchema.parse(body));
  }

  /** Delete the event, or the whole series. */
  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.delete(user, id);
  }

  /** "Delete this occurrence" — the series skips it (`occurrenceStart` URL-encoded). */
  @Delete('events/:id/occurrences/:occurrenceStart')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOccurrence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('occurrenceStart') occurrenceStart: string,
  ): Promise<void> {
    await this.service.deleteOccurrence(user, id, occurrenceStart);
  }
}
