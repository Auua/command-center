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

export async function createE2eApp(): Promise<E2eContext> {
  const mongo = await MongoMemoryServer.create();

  // Env must exist before AppModule is imported/compiled — ConfigModule
  // validates on module init (fail-fast contract from src/config/env.ts).
  process.env.SUPABASE_URL = 'https://e2e-placeholder.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'e2e-placeholder-anon-key';
  process.env.MONGODB_CONNECT = mongo.getUri();
  process.env.CORS_ORIGIN = 'http://localhost:3000';

  // Import after env setup so nothing captures a half-configured process.env.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const { JwtVerifierService } = await import('../src/auth/jwt-verifier.service');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(JwtVerifierService)
    .useClass(FakeJwtVerifierService)
    .compile();

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
