import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import type { Env } from './config/env';

/**
 * HTTP-level configuration shared by the real server (main.ts) and the e2e
 * test app (test/ builds the app from a TestingModule but must run the same
 * prefix, CORS, headers, and filters as production). Deliberately free of
 * `@nestjs/core` — Vercel's nestjs preset detects the entrypoint by its
 * NestFactory usage, which must stay in main.ts.
 */
export function configureApp(app: NestExpressApplication): void {
  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const corsOrigins = configService
    .get('CORS_ORIGIN', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  // Minimal helmet-style hardening; the full CSP story lives in the web app
  // middleware (ARD §5.2). Kept dependency-free for Phase 0.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.disable('x-powered-by');

  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableShutdownHooks();
}
