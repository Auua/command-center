import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

/** Browser Supabase client (auth flows only — ARD ADR-004). */
export function createClient(): ReturnType<typeof createBrowserClient> {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
