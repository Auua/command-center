import { InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { SupabaseService } from '../supabase/supabase.service';
import { MoodRepository } from './mood.repository';

const user: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  token: 'jwt',
};

/**
 * Chainable stub for the supabase-js query builder. Every method returns the
 * chain; awaiting it resolves to `result` (the builder is a thenable).
 */
function chain(result: {
  data?: unknown;
  error: { message: string; code?: string } | null;
}): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'gte',
    'order',
    'delete',
    'insert',
    'single',
    'maybeSingle',
  ]) {
    c[method] = jest.fn(() => c);
  }
  c.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> => Promise.resolve(result).then(resolve, reject);
  return c;
}

function makeRepository(...chains: Record<string, unknown>[]): {
  repo: MoodRepository;
  from: jest.Mock;
} {
  const from = jest.fn();
  for (const c of chains) {
    from.mockReturnValueOnce(c);
  }
  const client = { from };
  const supabaseService = {
    forUser: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;
  return { repo: new MoodRepository(supabaseService), from };
}

const ROW = {
  id: '6f2d38a0-9a1e-4a0e-8f2a-000000000001',
  mood_score: 4,
  tags: ['focused'],
  note: null,
  created_at: '2026-07-12T08:30:00+00:00',
};

describe('MoodRepository', () => {
  it('lists check-ins since a timestamp and maps them to the contract', async () => {
    const c = chain({ data: [ROW], error: null });
    const { repo, from } = makeRepository(c);

    const items = await repo.listSinceForUser(user, '2026-07-05T08:30:00.000Z');

    expect(from).toHaveBeenCalledWith('mood_checkins');
    expect(c.eq).toHaveBeenCalledWith('user_id', user.id);
    expect(c.gte).toHaveBeenCalledWith('created_at', '2026-07-05T08:30:00.000Z');
    expect(items).toEqual([
      {
        id: ROW.id,
        score: 4,
        tags: ['focused'],
        note: null,
        // +00:00 offsets are normalized to strict UTC "Z" datetimes.
        createdAt: '2026-07-12T08:30:00.000Z',
      },
    ]);
  });

  it('maps a null tags column to an empty array', async () => {
    const c = chain({ data: [{ ...ROW, tags: null }], error: null });
    const { repo } = makeRepository(c);

    const items = await repo.listSinceForUser(user, '2026-07-05T00:00:00.000Z');
    expect(items[0]?.tags).toEqual([]);
  });

  it('turns list errors into 500s', async () => {
    const { repo } = makeRepository(chain({ error: { message: 'boom' } }));

    await expect(repo.listSinceForUser(user, '2026-07-05T00:00:00.000Z')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('stamps the token user id on inserts', async () => {
    const c = chain({ data: ROW, error: null });
    const { repo } = makeRepository(c);

    await repo.createForUser(user, {
      mood_score: 4,
      tags: ['focused'],
      note: null,
    });

    expect(c.insert).toHaveBeenCalledWith({
      user_id: user.id,
      mood_score: 4,
      tags: ['focused'],
      note: null,
    });
  });

  it('surfaces corrupt stored rows as 500s, not ZodErrors', async () => {
    const c = chain({ data: [{ ...ROW, mood_score: 42 }], error: null });
    const { repo } = makeRepository(c);

    await expect(repo.listSinceForUser(user, '2026-07-05T00:00:00.000Z')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('returns true/false from delete depending on whether an owned row matched', async () => {
    const hit = chain({ data: { id: ROW.id }, error: null });
    const miss = chain({ data: null, error: null });
    const { repo } = makeRepository(hit, miss);

    await expect(repo.deleteForUser(user, ROW.id)).resolves.toBe(true);
    await expect(repo.deleteForUser(user, ROW.id)).resolves.toBe(false);
  });

  it('treats a malformed uuid as a miss, not a server fault', async () => {
    const { repo } = makeRepository(
      chain({ error: { message: 'invalid input syntax', code: '22P02' } }),
    );

    await expect(repo.deleteForUser(user, 'not-a-uuid')).resolves.toBe(false);
  });
});
