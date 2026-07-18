import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BraindumpModule } from './braindump/braindump.module';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { MoodModule } from './mood/mood.module';
import { TasksModule } from './tasks/tasks.module';
import { WidgetRegistryModule } from './widget-registry/widget-registry.module';

/**
 * API process root module — modular monolith (ADR-002). Domain modules never
 * import each other; cross-cutting concerns (auth, throttling, config) live
 * here or in core modules.
 *
 * Guard order matters: AuthModule registers the JWT guard first (imported
 * module providers register before this module's own APP_GUARD), so the
 * throttler can key rate limits on the authenticated user id.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000, // 1 minute window
          limit: 100, // 100 requests/min per user (ADR §5.2)
        },
      ],
    }),
    // In-process event bus for cross-domain reactions (ADR §4.1) — e.g.
    // TasksModule emits task.completed; AutomationModule listens in Phase 2.
    EventEmitterModule.forRoot(),
    AuthModule,
    BraindumpModule,
    HealthModule,
    MoodModule,
    TasksModule,
    WidgetRegistryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule {}
