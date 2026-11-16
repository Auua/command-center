import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { JournalSearchHit } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { decodeCursor } from './cursor';
import { JournalSearchService, SEARCH_RECHECK_MS } from './journal-search.service';
import type { JournalRepository } from './journal.repository';
import type { SearchIndexState } from './search';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-0000000000aa', token: 'jwt' };

const hit = (id: string, entryDate: string): JournalSearchHit => ({
  id,
  entryDate,
  textPreview: '',
  wordCount: 0,
  tags: [],
  promptId: null,
  version: 1,
  createdAt: '2026-11-10T07:00:00.000Z',
  updatedAt: '2026-11-10T07:00:00.000Z',
  highlights: [],
});

function makeService(states: (SearchIndexState | Error)[]): {
  service: JournalSearchService;
  entries: Record<'searchIndexState' | 'createJournalSearchIndex' | 'search', jest.Mock>;
} {
  const queue = [...states];
  const entries = {
    searchIndexState: jest.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    createJournalSearchIndex: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
  };
  return {
    service: new JournalSearchService(entries as unknown as JournalRepository),
    entries,
  };
}

describe('JournalSearchService', () => {
  it('creates the index when it is missing, and answers 503 while it builds', async () => {
    const { service, entries } = makeService(['missing']);
    await expect(service.search(user, { q: 'x', limit: 20 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(entries.createJournalSearchIndex).toHaveBeenCalledTimes(1);
    expect(entries.search).not.toHaveBeenCalled();
  });

  it('answers 503 where Atlas Search is not available, without throwing anything else', async () => {
    const { service } = makeService([
      new Error('Search index commands are only supported with Atlas'),
    ]);
    await expect(service.search(user, { q: 'x', limit: 20 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('asks Atlas again only after the recheck interval, and trusts ready for good', async () => {
    const { service, entries } = makeService(['building', 'ready']);
    expect(await service.isReady(0)).toBe(false);
    expect(await service.isReady(SEARCH_RECHECK_MS - 1)).toBe(false);
    expect(entries.searchIndexState).toHaveBeenCalledTimes(1);
    expect(await service.isReady(SEARCH_RECHECK_MS)).toBe(true);
    expect(await service.isReady(SEARCH_RECHECK_MS * 10)).toBe(true);
    expect(entries.searchIndexState).toHaveBeenCalledTimes(2);
  });

  it('shares one check between concurrent searches', async () => {
    const { service, entries } = makeService(['missing']);
    await Promise.all([service.isReady(0), service.isReady(0), service.isReady(0)]);
    expect(entries.searchIndexState).toHaveBeenCalledTimes(1);
    expect(entries.createJournalSearchIndex).toHaveBeenCalledTimes(1);
  });

  it('pages with the timeline cursor', async () => {
    const { service, entries } = makeService(['ready']);
    entries.search.mockResolvedValue([
      hit('6740a1b2c3d4e5f601234569', '2026-11-12'),
      hit('6740a1b2c3d4e5f601234568', '2026-11-11'),
      hit('6740a1b2c3d4e5f601234567', '2026-11-10'),
    ]);
    const page = await service.search(user, { q: 'heron', tag: 'birds', limit: 2 });
    expect(page.items.map((item) => item.entryDate)).toEqual(['2026-11-12', '2026-11-11']);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({
      entryDate: '2026-11-11',
      id: '6740a1b2c3d4e5f601234568',
    });
    expect(entries.search).toHaveBeenCalledWith(user.id, { q: 'heron', tag: 'birds', limit: 2 });

    entries.search.mockResolvedValue([hit('6740a1b2c3d4e5f601234567', '2026-11-10')]);
    const next = await service.search(user, {
      q: 'heron',
      limit: 2,
      cursor: page.nextCursor ?? '',
    });
    expect(next.nextCursor).toBeNull();
    expect(entries.search).toHaveBeenLastCalledWith(user.id, {
      q: 'heron',
      after: { entryDate: '2026-11-11', id: '6740a1b2c3d4e5f601234568' },
      limit: 2,
    });
  });

  it('rejects a malformed cursor before asking Atlas anything', async () => {
    const { service, entries } = makeService(['ready']);
    await expect(
      service.search(user, { q: 'x', limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(entries.searchIndexState).not.toHaveBeenCalled();
  });
});
