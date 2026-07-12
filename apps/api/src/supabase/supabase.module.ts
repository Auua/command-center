import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * Infrastructure module: exposes the RLS-scoped Supabase client factory.
 * Domain modules import this but own their repositories (ARD §4.1 — no
 * shared repositories across modules).
 */
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
