import { getApiUrl } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';

/**
 * Authenticated fetch against the NestJS API (ARD §3.1: all domain traffic
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
    throw new Error(`API request ${path} failed with status ${response.status}`);
  }

  return response;
}
