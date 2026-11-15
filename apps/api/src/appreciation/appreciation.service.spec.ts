import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ProfileService } from '../profile/profile.service';
import type { AppreciationRepository } from './appreciation.repository';
import { AppreciationService } from './appreciation.service';
import { pickPrompt } from './prompt';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-0000000000aa', token: 'jwt' };
const ENTRY = {
  id: '6f2d38a0-9a1e-4a0e-8f2a-000000000001',
  text: 'The neighbour’s dog said hi',
  tags: [],
  createdAt: '2026-11-15T08:30:00.000Z',
};
const PROMPTS = [
  { id: 'smile', text: { en: 'What made you smile today?', fi: 'Mikä sai sinut hymyilemään?' } },
  { id: 'taste', text: { en: 'What tasted good today?' } },
  { id: 'broken', text: { ja: '日本語だけ' } },
];

function fakeRepository(): Record<
  'listRecentForUser' | 'listAllForUser' | 'createForUser' | 'deleteForUser' | 'listActivePrompts',
  jest.Mock
> {
  return {
    listRecentForUser: jest.fn().mockResolvedValue([ENTRY]),
    listAllForUser: jest.fn().mockResolvedValue([ENTRY]),
    createForUser: jest.fn().mockResolvedValue(ENTRY),
    deleteForUser: jest.fn().mockResolvedValue(true),
    listActivePrompts: jest.fn().mockResolvedValue(PROMPTS),
  };
}

function makeService(timezone = 'Europe/Helsinki'): {
  service: AppreciationService;
  repository: ReturnType<typeof fakeRepository>;
} {
  const repository = fakeRepository();
  const profile = { getTimezone: jest.fn().mockResolvedValue(timezone) };
  return {
    service: new AppreciationService(
      repository as unknown as AppreciationRepository,
      profile as unknown as ProfileService,
    ),
    repository,
  };
}

describe('AppreciationService', () => {
  it('lists the newest entries up to the limit', async () => {
    const { service, repository } = makeService();
    await expect(service.list(user, 3)).resolves.toEqual({ items: [ENTRY] });
    expect(repository.listRecentForUser).toHaveBeenCalledWith(user, 3);
  });

  it('creates with the validated text and tags only', async () => {
    const { service, repository } = makeService();
    await service.create(user, { text: 'Sun on the balcony', tags: ['home'] });
    expect(repository.createForUser).toHaveBeenCalledWith(user, {
      text: 'Sun on the balcony',
      tags: ['home'],
    });
  });

  it('404s a delete that matched nothing', async () => {
    const { service, repository } = makeService();
    repository.deleteForUser.mockResolvedValueOnce(false);
    await expect(service.delete(user, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(user, ENTRY.id)).resolves.toBeUndefined();
  });

  it('exports every entry with a timestamp', async () => {
    const { service } = makeService();
    const now = new Date('2026-11-15T12:00:00Z');
    await expect(service.export(user, now)).resolves.toEqual({
      exportedAt: '2026-11-15T12:00:00.000Z',
      items: [ENTRY],
    });
  });

  it('picks the prompt for the local day in the home timezone, localized', async () => {
    const { service } = makeService('Europe/Helsinki');
    // 23:30 UTC on the 15th is the 16th in Helsinki.
    const now = new Date('2026-11-15T23:30:00Z');
    const today = await service.promptToday(user, 'fi', now);
    expect(today.date).toBe('2026-11-16');

    // The pick is made among the prompts with usable text in that locale or
    // English — "broken" has only Japanese.
    const expected = pickPrompt(
      [
        { id: 'smile', text: 'Mikä sai sinut hymyilemään?' },
        { id: 'taste', text: 'What tasted good today?' },
      ],
      user.id,
      '2026-11-16',
    );
    expect(today).toEqual({ ...expected, date: '2026-11-16' });
  });

  it('404s when no prompt is active', async () => {
    const { service, repository } = makeService();
    repository.listActivePrompts.mockResolvedValueOnce([]);
    await expect(service.promptToday(user, 'en')).rejects.toBeInstanceOf(NotFoundException);
  });
});
