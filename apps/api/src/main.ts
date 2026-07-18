import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import type { Env } from './config/env';

/**
 * API process entrypoint (ADR §3.1). Structured JSON logs (NFR-10); the
 * shared HTTP configuration (prefix, CORS, headers, filters) lives in
 * bootstrap.ts so the e2e tests run the same setup.
 *
 * Vercel's nestjs framework preset detects this file by its `@nestjs/core`
 * import and wraps `app.listen` in a serverless shim — keep NestFactory
 * usage in this file (not extracted into a helper module).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });

  configureApp(app);

  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const port = configService.get('PORT', { infer: true });

  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port} (prefix /api/v1, public /health)`);
}

void bootstrap();
