import { z } from 'zod';

/**
 * Environment contract for both the API and worker processes.
 * Validated on boot via @nestjs/config `validate` — the process refuses to
 * start with a clear message if anything is missing/malformed (fail fast).
 */
export const EnvSchema = z.object({
  /** HTTP port for the API process. */
  PORT: z.coerce.number().int().positive().default(3001),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  /** Supabase project URL, e.g. https://xyz.supabase.co */
  SUPABASE_URL: z.string().url({ message: 'SUPABASE_URL must be a valid URL' }),
  /** Supabase anon (publishable) key — RLS-respecting role, never service_role. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'SUPABASE_PUBLISHABLE_KEY is required'),
  /**
   * MongoDB Atlas connection string (ADR §4.3 — document store). May omit a
   * database name in the path; MongoService then falls back to
   * "command_center".
   */
  MONGODB_CONNECT: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_CONNECT must be a mongodb:// or mongodb+srv:// URI'),
  /**
   * Supabase secret (service-role) key — the RLS-bypassing credential of the
   * ADR-039 carve-out. Server-only; consumed by exactly one repository
   * (scheduler). Never logged, never NEXT_PUBLIC_*.
   */
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  /**
   * Shared secret guarding POST /api/v1/internal/tick (ADR-039). Generate a
   * ≥ 256-bit random value: `openssl rand -hex 32`.
   */
  TICK_SECRET: z.string().min(32, 'TICK_SECRET must be at least 32 characters (256-bit random)'),
  /** VAPID keypair for Web Push — `npx web-push generate-vapid-keys`. */
  VAPID_PUBLIC_KEY: z.string().min(1, 'VAPID_PUBLIC_KEY is required'),
  VAPID_PRIVATE_KEY: z.string().min(1, 'VAPID_PRIVATE_KEY is required'),
  /** VAPID contact, a mailto: or https: URL (Web Push spec requirement). */
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:)/, 'VAPID_SUBJECT must be a mailto: or https: URL'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration for @command-center/api:\n${details}\n` +
        'See apps/api/src/config/env.ts (EnvSchema) for the expected shape.',
    );
  }
  return result.data;
}
