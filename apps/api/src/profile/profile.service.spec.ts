import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ProfileRepository } from './profile.repository';
import { DEFAULT_TIMEZONE, ProfileService } from './profile.service';

const ANNA: AuthenticatedUser = { id: 'user-1', token: 'jwt' };

class FakeProfileRepository {
  timezone: string | null = null;
  upserts: string[] = [];

  getTimezoneForUser(): Promise<string | null> {
    return Promise.resolve(this.timezone);
  }

  upsertTimezoneForUser(_user: AuthenticatedUser, timezone: string): Promise<string> {
    this.upserts.push(timezone);
    this.timezone = timezone;
    return Promise.resolve(timezone);
  }
}

describe('ProfileService', () => {
  let repository: FakeProfileRepository;
  let service: ProfileService;

  beforeEach(() => {
    repository = new FakeProfileRepository();
    service = new ProfileService(repository as unknown as ProfileRepository);
  });

  it('404s getProfile before first capture — the client-side D4 cue', async () => {
    await expect(service.getProfile(ANNA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the stored profile once captured', async () => {
    repository.timezone = 'Europe/Helsinki';
    await expect(service.getProfile(ANNA)).resolves.toEqual({ timezone: 'Europe/Helsinki' });
  });

  it('upserts on update and echoes the stored value', async () => {
    await expect(service.updateProfile(ANNA, { timezone: 'Asia/Tokyo' })).resolves.toEqual({
      timezone: 'Asia/Tokyo',
    });
    expect(repository.upserts).toEqual(['Asia/Tokyo']);
  });

  it('getTimezone falls back to UTC before first capture', async () => {
    await expect(service.getTimezone(ANNA)).resolves.toBe(DEFAULT_TIMEZONE);
    repository.timezone = 'Europe/Helsinki';
    await expect(service.getTimezone(ANNA)).resolves.toBe('Europe/Helsinki');
  });
});
