import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Maps ZodErrors thrown by explicit `schema.parse(...)` calls in controllers
 * into 400 responses with a structured issue list. This is the "global zod
 * validation" mechanism for Phase 0 — no class-validator (ADR §5.2 uses zod
 * at the contract layer).
 *
 * Note: repositories must NOT let ZodErrors escape for data *they* read from
 * the database (that would misreport a server-side problem as a client 400);
 * they wrap parse failures in 500s instead.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter<ZodError> {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'Validation failed',
      issues: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}
