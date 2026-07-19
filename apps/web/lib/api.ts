import { getApiUrl } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';

/** Non-2xx API response, with the status attached for callers that branch
 * on it (e.g. profile 404 → "no profile yet"). Still an Error, so existing
 * catch-all error states keep working unchanged. */
export class ApiError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`API request ${path} failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Authenticated fetch against the NestJS API (ADR §3.1: all domain traffic
 * goes through /api/v1 with the Supabase access token as Bearer auth).
 * Throws on missing session or non-2xx responses — widget hooks surface that
 * as the widget's error state.
 */
export async function apiFetch(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('No active session');
  }

  const { body, headers, ...rest } = init;
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new ApiError(path, response.status);
  }

  return response;
}
