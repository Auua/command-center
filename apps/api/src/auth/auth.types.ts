import type { Request } from 'express';

/**
 * User identity extracted from a verified Supabase JWT.
 * `token` is the raw JWT — repositories forward it to Supabase so Postgres
 * RLS enforces user scoping on every query (ARD §5.1).
 */
export interface AuthenticatedUser {
  id: string;
  token: string;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
