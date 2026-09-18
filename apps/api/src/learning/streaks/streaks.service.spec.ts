import 'reflect-metadata';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { ProfileService } from '../../profile/profile.service';
import { StreaksService } from './streaks.service';
import type { StreaksRepository } from './streaks.repository';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-000000000001', token: 'jwt' };

function makeService(
  rowsByKey: Record<
    string,
    { currentLen: number; bestLen: number; lastActiveDate: string | null }
  > = {},
): {
  service: StreaksService;
  repository: jest.Mocked<
    Pick<StreaksRepository, 'insertDay' | 'getRow' | 'upsertRow' | 'listRows' | 'listDays'>
  >;
} {
  const repository = {
    insertDay: jest.fn().mockResolvedValue(true),
    getRow: jest.fn((_user: AuthenticatedUser, key: string) =>
      Promise.resolve(rowsByKey[key] ?? null),
    ),
    upsertRow: jest.fn().mockResolvedValue(undefined),
    listRows: jest
      .fn()
      .mockResolvedValue(
        Object.entries(rowsByKey).map(([streakKey, row]) => ({ streakKey, ...row })),
      ),
    listDays: jest.fn().mockResolvedValue(new Map()),
  };
  const profile = {
    getTimezone: jest.fn().mockResolvedValue('Europe/Helsinki'),
  } as unknown as ProfileService;
  return {
    service: new StreaksService(repository as unknown as StreaksRepository, profile),
    repository,
  };
}

describe('StreaksService.record', () => {
  it('skips (and does not throw) when the event carries no request context', async () => {
    const { service, repository } = makeService();
    await service.onTaskCompleted(
      { userId: user.id, taskId: 't', title: 'x', completedAt: '2026-09-18T10:00:00.000Z' },
      undefined,
    );
    expect(repository.insertDay).not.toHaveBeenCalled();
  });

  it('records the home-timezone day with grace and starts a streak', async () => {
    const { service, repository } = makeService();
    await service.onWotdAcknowledged(
      {
        userId: user.id,
        itemId: 'x.md',
        date: '2026-09-18',
        acknowledgedAt: '2026-09-18T21:30:00.000Z',
      },
      { user },
    );
    // 00:30 Helsinki on the 19th → still the 18th.
    expect(repository.insertDay).toHaveBeenCalledWith(user, 'japanese-wotd', '2026-09-18');
    expect(repository.upsertRow).toHaveBeenCalledWith(user, 'japanese-wotd', {
      currentLen: 1,
      bestLen: 1,
      lastActiveDate: '2026-09-18',
    });
  });

  it('is idempotent: a duplicate day mark leaves the row untouched', async () => {
    const { service, repository } = makeService();
    repository.insertDay.mockResolvedValue(false);
    await service.onGrammarStudied(
      {
        userId: user.id,
        itemId: 'g.md',
        date: '2026-09-18',
        studiedAt: '2026-09-18T10:00:00.000Z',
      },
      { user },
    );
    expect(repository.upsertRow).not.toHaveBeenCalled();
  });

  it('swallows repository failures so the source action still succeeds', async () => {
    const { service, repository } = makeService();
    repository.insertDay.mockRejectedValue(new Error('db down'));
    await expect(
      service.onTaskCompleted(
        { userId: user.id, taskId: 't', title: 'x', completedAt: '2026-09-18T10:00:00.000Z' },
        { user },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('StreaksService.getStreaks', () => {
  it('orders by the known keys, applies read-time rollover, and builds last7', async () => {
    const today = new Date().toISOString();
    const { service, repository } = makeService({
      'japanese-wotd': { currentLen: 3, bestLen: 5, lastActiveDate: '2020-01-01' },
      tasks: { currentLen: 2, bestLen: 2, lastActiveDate: '2020-01-02' },
    });
    repository.listDays.mockResolvedValue(new Map([['tasks', new Set(['2020-01-02'])]]));

    const response = await service.getStreaks(user);

    expect(response.timezone).toBe('Europe/Helsinki');
    expect(response.streaks.map((streak) => streak.streakKey)).toEqual(['tasks', 'japanese-wotd']);
    expect(response.streaks[0]?.currentLen).toBe(0); // 2020 is long dead
    expect(response.streaks[0]?.bestLen).toBe(2);
    expect(response.streaks[0]?.last7).toHaveLength(7);
    expect(response.streaks[0]?.activeToday).toBe(false);
    expect(today).toBeTruthy();
  });
});
