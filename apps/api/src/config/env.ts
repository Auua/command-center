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
