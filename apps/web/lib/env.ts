/**
 * Environment access. NEXT_PUBLIC_* variables must be referenced statically
 * (process.env.NEXT_PUBLIC_X) so Next.js can inline them into client bundles —
 * hence one function per variable rather than a generic lookup.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabaseAnonKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** Base URL of the NestJS API, e.g. http://localhost:3001 */
export function getApiUrl(): string {
  return required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL);
}
