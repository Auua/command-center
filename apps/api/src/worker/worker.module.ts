import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../config/env';
import { HeartbeatService } from './heartbeat.service';

/**
 * Worker process root module (ADR §3.1): same codebase as the API, separate
 * entrypoint, no HTTP surface. Shares the validated env contract so both
 * processes fail fast on misconfiguration.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [HeartbeatService],
})
export class WorkerModule {}
