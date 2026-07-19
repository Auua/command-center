import {
  Catch,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseFilters,
  UseGuards,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { SchedulerService } from './scheduler.service';
import { TickSecretGuard } from './tick.guard';

/**
 * ADR-039: a 401 from the tick route carries no body — nothing for an
 * unauthenticated caller to learn, not even an error shape.
 */
@Catch(UnauthorizedException)
export class BodylessUnauthorizedFilter implements ExceptionFilter<UnauthorizedException> {
  catch(_exception: UnauthorizedException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(HttpStatus.UNAUTHORIZED).end();
  }
}

/**
 * POST /api/v1/internal/tick — the external pinger's entry point (ADR-039),
 * the API's second non-JWT route after /health. @Public() bypasses the
 * global Supabase-JWT guard *explicitly*; TickSecretGuard takes over with
 * the shared-secret check. The request carries no usable input — body and
 * query are ignored entirely — and success is 204 No Content: no counts, no
 * timings.
 */
@Controller('internal')
@UseFilters(BodylessUnauthorizedFilter)
export class TickController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Public()
  @UseGuards(TickSecretGuard)
  @Post('tick')
  @HttpCode(HttpStatus.NO_CONTENT)
  async tick(): Promise<void> {
    await this.schedulerService.tick();
  }
}
