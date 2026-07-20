import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Test doubles and app factory for API e2e tests.
 *
 * Real pieces: the full AppModule HTTP stack (routing, guards, throttling,
 * zod filter, global prefix via configureApp) and a real MongoDB served by
 * mongodb-memory-server.
 *
 * Faked piece: JWT *cryptography only*. Supabase's JWKS endpoint can't be
 * reached hermetically, so JwtVerifierService is replaced with a stub that
 * accepts tokens of the form `e2e-token:<user-id>`. The guard logic itself
 * (header parsing, sub extraction, request user context) still runs for real.
 */

export const E2E_TOKEN_PREFIX = 'e2e-token:';

/** Tick-route shared secret the e2e app boots with (≥ 32 chars, env contract). */
export const E2E_TICK_SECRET = 'e2e-tick-secret-0123456789abcdef0123456789abcdef';

/** Bearer token the fake verifier will accept for the given user id. */
export function tokenFor(userId: string): string {
  return `${E2E_TOKEN_PREFIX}${userId}`;
}

class FakeJwtVerifierService {
  verify(token: string): Promise<Record<string, unknown>> {
    if (!token.startsWith(E2E_TOKEN_PREFIX)) {
      return Promise.reject(new Error('e2e: unrecognized token'));
    }
    const sub = token.slice(E2E_TOKEN_PREFIX.length);
    return Promise.resolve({ sub, aud: 'authenticated' });
  }
}

export interface E2eContext {
  app: NestExpressApplication;
  mongo: MongoMemoryServer;
  close: () => Promise<void>;
}

export interface E2eOptions {
  /**
   * Extra provider overrides (e.g. stubbing SchedulerService so a tick with
   * the correct secret returns 204 without reaching the placeholder
   * Supabase). JWT verification is always stubbed.
   */
  overrides?: { provide: unknown; useValue: unknown }[];
}

export async function createE2eApp(options: E2eOptions = {}): Promise<E2eContext> {
  const mongo = await MongoMemoryServer.create();

  // Env must exist before AppModule is imported/compiled — ConfigModule
  // validates on module init (fail-fast contract from src/config/env.ts).
  process.env.SUPABASE_URL = 'https://e2e-placeholder.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'e2e-placeholder-anon-key';
  process.env.MONGODB_CONNECT = mongo.getUri();
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  // Phase 2 (ADR-039) — placeholders only: e2e never reaches Supabase with
  // the service-role key and never sends a real push.
  process.env.SUPABASE_SECRET_KEY = 'e2e-placeholder-secret-key';
  process.env.TICK_SECRET = E2E_TICK_SECRET;
  process.env.VAPID_PUBLIC_KEY = 'e2e-placeholder-vapid-public';
  process.env.VAPID_PRIVATE_KEY = 'e2e-placeholder-vapid-private';
  process.env.VAPID_SUBJECT = 'mailto:e2e@example.com';

  // Load after env setup so nothing captures a half-configured process.env.
  // Deferred require() rather than import(): under module=nodenext, tsc keeps
  // dynamic import() as a real ESM import in CommonJS output (extension
  // required, and Jest's CJS runtime can't execute it).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
  const { configureApp } = require('../src/bootstrap') as typeof import('../src/bootstrap');
  const { JwtVerifierService } =
    require('../src/auth/jwt-verifier.service') as typeof import('../src/auth/jwt-verifier.service');
  /* eslint-enable @typescript-eslint/no-require-imports */

  let builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(JwtVerifierService)
    .useClass(FakeJwtVerifierService);
  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    mongo,
    close: async (): Promise<void> => {
      await app.close();
      await mongo.stop();
    },
  };
}
