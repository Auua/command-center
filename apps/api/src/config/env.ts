import { z } from 'zod';

/**
 * Environment contract for both the API and worker processes.
 * Validated on boot via @nestjs/config `validate` — the process refuses to
 * start with a clear message if anything is missing/malformed (fail fast).
 *
 * The Phase 2 scheduler group (ADR-039) is optional **as a whole**: with none
 * of the five set the API boots and serves every user-facing route, while
 * the tick answers 401, `/health` reports `tick: "unconfigured"`, and event
 * dispatch logs and skips. A partial group is a configuration error.
 */
const SCHEDULER_KEYS = [
  'SUPABASE_SECRET_KEY',
  'TICK_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const;

/**
 * The learning vault pair (ADR-024/040) is optional as a whole too: unset,
 * every /learning read answers `{ configured: false }` and the widgets show
 * their not-configured state.
 */
const LEARNING_KEYS = ['GITHUB_LEARNING_REPO', 'GITHUB_LEARNING_TOKEN'] as const;

export const EnvSchema = z
  .object({
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
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    /**
     * Shared secret guarding POST /api/v1/internal/tick (ADR-039). Generate a
     * ≥ 256-bit random value: `openssl rand -hex 32`.
     */
    TICK_SECRET: z
      .string()
      .min(32, 'TICK_SECRET must be at least 32 characters (256-bit random)')
      .optional(),
    /** VAPID keypair for Web Push — `npx web-push generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    /** VAPID contact, a mailto: or https: URL (Web Push spec requirement). */
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:)/, 'VAPID_SUBJECT must be a mailto: or https: URL')
      .optional(),
    /** `owner/name` of the private learning-center vault repo (ADR-024/040). */
    GITHUB_LEARNING_REPO: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'GITHUB_LEARNING_REPO must be owner/name')
      .optional(),
    /** Fine-grained PAT, Contents read/write on that one repo. Never logged. */
    GITHUB_LEARNING_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const learningPresent = LEARNING_KEYS.filter((key) => env[key] !== undefined);
    if (learningPresent.length === 1) {
      const missing = LEARNING_KEYS.filter((key) => env[key] === undefined);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing[0] ?? 'GITHUB_LEARNING_REPO'],
        message:
          'Learning vault env is a pair (ADR-024): set GITHUB_LEARNING_REPO and ' +
          `GITHUB_LEARNING_TOKEN together or neither. Missing: ${missing.join(', ')}`,
      });
    }
    const present = SCHEDULER_KEYS.filter((key) => env[key] !== undefined);
    if (present.length !== 0 && present.length !== SCHEDULER_KEYS.length) {
      const missing = SCHEDULER_KEYS.filter((key) => env[key] === undefined);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing[0] ?? 'SUPABASE_SECRET_KEY'],
        message:
          `Phase 2 scheduler env is all-or-nothing (ADR-039): set ${SCHEDULER_KEYS.join(', ')} ` +
          `together or leave them all unset. Missing: ${missing.join(', ')}`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** True iff the whole ADR-039 scheduler group is set. */
export function isSchedulerConfigured(env: Pick<Env, (typeof SCHEDULER_KEYS)[number]>): boolean {
  return SCHEDULER_KEYS.every((key) => env[key] !== undefined);
}

/** True iff the ADR-024 vault pair is set. */
export function isLearningConfigured(env: Pick<Env, (typeof LEARNING_KEYS)[number]>): boolean {
  return LEARNING_KEYS.every((key) => env[key] !== undefined);
}

const OPTIONAL_GROUP_KEYS: readonly string[] = [...SCHEDULER_KEYS, ...LEARNING_KEYS];

export function validateEnv(config: Record<string, unknown>): Env {
  // Empty strings (an unset dashboard field, a placeholder line) count as unset.
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) => !(value === '' && OPTIONAL_GROUP_KEYS.includes(key)),
    ),
  );
  const result = EnvSchema.safeParse(cleaned);
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
