import { InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { SupabaseService } from '../supabase/supabase.service';
import { AppreciationRepository, EXPORT_PAGE } from './appreciation.repository';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-000000000001', token: 'jwt' };

/** Chainable stub for the supabase-js query builder (a thenable). */
function chain(result: {
  data?: unknown;
  error: { message: string; code?: string } | null;
}): Record<string, jest.Mock> & { then: unknown } {
  const c: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'order',
    'range',
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
  return c as Record<string, jest.Mock> & { then: unknown };
}

function makeRepository(...chains: Record<string, unknown>[]): {
  repo: AppreciationRepository;
  from: jest.Mock;
} {
  const from = jest.fn();
  for (const c of chains) from.mockReturnValueOnce(c);
  const supabaseService = {
    forUser: jest.fn().mockReturnValue({ from }),
  } as unknown as SupabaseService;
  return { repo: new AppreciationRepository(supabaseService), from };
}

const row = (n: number): Record<string, unknown> => ({
  id: `6f2d38a0-9a1e-4a0e-8f2a-${String(n).padStart(12, '0')}`,
  text: `entry ${n}`,
  tags: null,
  created_at: '2026-11-15T08:30:00+00:00',
});

describe('AppreciationRepository', () => {
  it('lists the newest entries of the caller, mapped to the contract', async () => {
    const c = chain({ data: [row(1)], error: null });
    const { repo, from } = makeRepository(c);

    const items = await repo.listRecentForUser(user, 3);

    expect(from).toHaveBeenCalledWith('appreciation_entries');
    expect(c.eq).toHaveBeenCalledWith('user_id', user.id);
    expect(c.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(c.range).toHaveBeenCalledWith(0, 2);
    expect(items).toEqual([
      {
        id: row(1).id,
        text: 'entry 1',
        tags: [],
        createdAt: '2026-11-15T08:30:00.000Z',
      },
    ]);
  });

  it('pages through every entry for the export', async () => {
    const full = Array.from({ length: EXPORT_PAGE }, (_, i) => row(i + 1));
    const first = chain({ data: full, error: null });
    const second = chain({ data: [row(EXPORT_PAGE + 1)], error: null });
    const { repo } = makeRepository(first, second);

    const items = await repo.listAllForUser(user);

    expect(items).toHaveLength(EXPORT_PAGE + 1);
    expect(first.range).toHaveBeenCalledWith(0, EXPORT_PAGE - 1);
    expect(second.range).toHaveBeenCalledWith(EXPORT_PAGE, 2 * EXPORT_PAGE - 1);
  });

  it('inserts with the user id from the token', async () => {
    const c = chain({ data: row(1), error: null });
    const { repo } = makeRepository(c);
    await repo.createForUser(user, { text: 'entry 1', tags: [] });
    expect(c.insert).toHaveBeenCalledWith({ user_id: user.id, text: 'entry 1', tags: [] });
  });

  it('treats a malformed id as "not found" and other errors as 500s', async () => {
    const malformed = chain({ data: null, error: { message: 'bad uuid', code: '22P02' } });
    const broken = chain({ data: null, error: { message: 'down' } });
    const { repo } = makeRepository(malformed, broken);
    await expect(repo.deleteForUser(user, 'nope')).resolves.toBe(false);
    await expect(repo.deleteForUser(user, 'x')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('lists active prompts and drops rows without a text object', async () => {
    const c = chain({
      data: [
        { id: 'smile', text: { en: 'What made you smile today?' } },
        { id: 'odd', text: null },
      ],
      error: null,
    });
    const { repo, from } = makeRepository(c);
    const prompts = await repo.listActivePrompts(user);
    expect(from).toHaveBeenCalledWith('appreciation_prompts');
    expect(c.eq).toHaveBeenCalledWith('active', true);
    expect(prompts.map((p) => p.id)).toEqual(['smile']);
  });

  it('surfaces corrupt stored rows as 500s', async () => {
    const c = chain({ data: [{ ...row(1), text: '' }], error: null });
    const { repo } = makeRepository(c);
    await expect(repo.listRecentForUser(user, 3)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
