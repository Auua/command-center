import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

/**
 * Worker entrypoint (ARD §3.1): boots a NestJS application context — no HTTP
 * listener — so a stuck job can never block interactive API requests.
 *
 * Phase 0: heartbeat stub only (see HeartbeatService).
 * TODO(Phase 2): wire up pg-boss (ADR-005) — cron evaluation for
 * automations, push dispatch, Anki sync, streak rollover.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.enableShutdownHooks();
}

void bootstrap();
