import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env';

/** Routes reachable without a session. */
function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/auth');
}

/**
 * Refreshes the Supabase session on every request and enforces the
 * phase-0 auth policy (ARD §5.1):
 * - unauthenticated users are redirected to /login (except /login, /auth/*)
 * - authenticated users are redirected away from /login
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: getUser() revalidates the JWT against Supabase — do not trust
  // getSession() alone in middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    return redirectPreservingCookies(request, supabaseResponse, '/login');
  }

  if (user && pathname === '/login') {
    return redirectPreservingCookies(request, supabaseResponse, '/');
  }

  return supabaseResponse;
}

/**
 * Build a redirect that keeps any refreshed auth cookies set during this
 * request, so the session refresh is not lost across the redirect.
 */
function redirectPreservingCookies(
  request: NextRequest,
  baseResponse: NextResponse,
  pathname: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';

  const response = NextResponse.redirect(url);
  for (const cookie of baseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}
