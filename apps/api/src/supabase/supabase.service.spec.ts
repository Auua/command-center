import type { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';
import { SupabaseService } from './supabase.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({ mocked: true }),
}));

const config = {
  get: (key: string) =>
    ({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    })[key],
} as unknown as ConfigService<Env, true>;

describe('SupabaseService', () => {
  it("builds per-request clients with the anon key and the caller's JWT", () => {
    const service = new SupabaseService(config);

    service.forUser('caller-jwt');

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
        global: { headers: { Authorization: 'Bearer caller-jwt' } },
      }),
    );
  });
});
