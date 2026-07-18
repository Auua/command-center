import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';

/**
 * Factory for RLS-scoped Supabase clients (ADR §5.1).
 *
 * Clients are created per request with the anon key plus the caller's own
 * JWT in the Authorization header, so every Postgres query runs as that
 * user and RLS policies (`auth.uid() = user_id`) apply. The service_role
 * key is deliberately never used here.
 */
@Injectable()
export class SupabaseService {
  private readonly supabaseUrl: string;
  private readonly anonKey: string;

  constructor(configService: ConfigService<Env, true>) {
    this.supabaseUrl = configService.get('SUPABASE_URL', { infer: true });
    this.anonKey = configService.get('SUPABASE_PUBLISHABLE_KEY', { infer: true });
  }

  /** Creates a client that executes queries as the given user (raw JWT). */
  forUser(token: string): SupabaseClient {
    return createClient(this.supabaseUrl, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
  }
}
