import 'reflect-metadata';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { IndexCacheService } from '../index/index-cache.service';
import type { LearningAlertsService } from '../learning-alerts.service';
import {
  VaultNotFoundError,
  VaultTokenInvalidError,
  type VaultClient,
} from '../vault/vault.client';
import { AnkiStatusService } from './anki-status.service';

const user: AuthenticatedUser = { id: 'u1', token: 'jwt' };

const STATE = {
  schemaVersion: 1,
  lastSyncAt: '2026-09-18T19:00:00Z',
  lastRun: {
    at: '2026-09-18T19:00:00Z',
    status: 'ok',
    runId: '1',
    url: 'https://github.com/x/y/actions/runs/1',
  },
  counts: { cards: 12465, added: 3, updated: 0, unchanged: 12462, failed: 0 },
  decks: [{ name: 'Japani', notes: 12465, dueToday: 40 }],
  errors: [],
};

function makeService(options: {
  configured?: boolean;
  file?: unknown;
  fileError?: Error;
  commits?: number;
  indexState?: string;
}): {
  service: AnkiStatusService;
  alerts: { raise: jest.Mock; clear: jest.Mock };
  vault: { getFile: jest.Mock };
} {
  const vault = {
    configured: options.configured ?? true,
    actionsUrl: 'https://github.com/auua/learning-center/actions',
    getFile: options.fileError
      ? jest.fn().mockRejectedValue(options.fileError)
      : jest.fn().mockResolvedValue({ content: JSON.stringify(options.file ?? STATE), sha: 's' }),
    countCommitsSince: jest.fn().mockResolvedValue(options.commits ?? 2),
  };
  const index = { state: options.indexState ?? 'ok' } as unknown as IndexCacheService;
  const alerts = { raise: jest.fn().mockResolvedValue(undefined), clear: jest.fn() };
  return {
    service: new AnkiStatusService(
      vault as unknown as VaultClient,
      index,
      alerts as unknown as LearningAlertsService,
    ),
    alerts,
    vault,
  };
}

describe('AnkiStatusService', () => {
  it('answers configured: false without the vault pair', async () => {
    const { service } = makeService({ configured: false });
    await expect(service.status(user)).resolves.toEqual({ configured: false });
  });

  it('composes state.json with the pending commit count', async () => {
    const { service, alerts } = makeService({ commits: 2 });
    const response = await service.status(user);
    expect(response).toMatchObject({
      configured: true,
      state: 'ok',
      lastSyncAt: '2026-09-18T19:00:00Z',
      lastRunStatus: 'ok',
      pendingCommits: 2,
      decks: [{ name: 'Japani', notes: 12465 }],
    });
    expect(alerts.clear).toHaveBeenCalledWith(user, 'anki-sync-failed');
  });

  it('reports "never" before the first run (no state file) and caches the read', async () => {
    const { service, vault } = makeService({
      fileError: new VaultNotFoundError('sync/state.json'),
    });
    const first = await service.status(user);
    await service.status(user);
    expect(first).toMatchObject({ lastRunStatus: 'never', pendingCommits: 0, lastSyncAt: null });
    expect(vault.getFile).toHaveBeenCalledTimes(1);
  });

  it('raises the bell alert on a failed run', async () => {
    const { service, alerts } = makeService({
      file: { ...STATE, lastRun: { ...STATE.lastRun, status: 'failed' }, errors: ['boom'] },
    });
    const response = await service.status(user);
    expect(response).toMatchObject({ lastRunStatus: 'failed', errors: ['boom'] });
    expect(alerts.raise).toHaveBeenCalledWith(user, 'anki-sync-failed');
  });

  it('flips to token-invalid on a rejected token and to unavailable on other errors', async () => {
    const dead = makeService({ fileError: new VaultTokenInvalidError() });
    expect((await dead.service.status(user)) as { state: string }).toMatchObject({
      state: 'token-invalid',
    });
    expect(dead.alerts.raise).toHaveBeenCalledWith(user, 'token-invalid');

    const down = makeService({ fileError: new Error('ECONNRESET') });
    expect((await down.service.status(user)) as { state: string }).toMatchObject({
      state: 'unavailable',
    });
  });
});
