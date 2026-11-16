import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CalendarEvent, CalendarEventWriteParsed } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ProfileService } from '../profile/profile.service';
import type { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-0000000000aa', token: 'jwt' };
const ID = '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e';

const weekly: CalendarEvent = {
  id: ID,
  title: 'Swim',
  location: null,
  note: null,
  rrule: 'FREQ=WEEKLY',
  exdates: ['2026-11-10T16:00:00.000Z'],
  timeZone: 'Europe/Helsinki',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  allDay: false,
  startsAt: '2026-11-03T16:00:00.000Z',
  endsAt: '2026-11-03T17:00:00.000Z',
};

const write = (over: Partial<CalendarEventWriteParsed> = {}): CalendarEventWriteParsed =>
  ({
    allDay: false,
    title: 'Swim',
    location: null,
    note: null,
    rrule: 'FREQ=WEEKLY',
    startsAt: '2026-11-03T16:00:00.000Z',
    endsAt: '2026-11-03T17:00:00.000Z',
    ...over,
  }) as CalendarEventWriteParsed;

function makeService(zone = 'Europe/Helsinki'): {
  service: CalendarService;
  repo: Record<
    'listForRange' | 'findById' | 'create' | 'replace' | 'setExdates' | 'delete',
    jest.Mock
  >;
} {
  const repo = {
    listForRange: jest.fn().mockResolvedValue([weekly]),
    findById: jest.fn().mockResolvedValue(weekly),
    create: jest.fn(async (_u, values) => ({ ...weekly, ...values.event, exdates: [] })),
    replace: jest.fn(async (_u, _id, values) => ({ ...weekly, exdates: values.exdates })),
    setExdates: jest.fn(async (_u, _id, exdates) => ({ ...weekly, exdates })),
    delete: jest.fn().mockResolvedValue(true),
  };
  const profile = { getTimezone: jest.fn().mockResolvedValue(zone) } as unknown as ProfileService;
  return { service: new CalendarService(repo as unknown as CalendarRepository, profile), repo };
}

describe('CalendarService.range', () => {
  it('reads the range’s days in the home timezone and expands the series', async () => {
    const { service, repo } = makeService();
    const response = await service.range(user, { from: '2026-11-01', to: '2026-11-15' });

    expect(repo.listForRange).toHaveBeenCalledWith(user, {
      startsBefore: '2026-11-14T22:00:00.000Z',
      endsAfter: '2026-10-31T22:00:00.000Z',
      fromDate: '2026-11-01',
      toDate: '2026-11-15',
    });
    expect(response.timeZone).toBe('Europe/Helsinki');
    // The 10th is skipped.
    expect(response.occurrences.map((o) => o.occurrenceStart)).toEqual([
      '2026-11-03T16:00:00.000Z',
    ]);
  });

  it('turns too many occurrences into a 400 that says to narrow the range', async () => {
    const { service, repo } = makeService();
    repo.listForRange.mockResolvedValue([{ ...weekly, rrule: 'FREQ=HOURLY', exdates: [] }]);
    await expect(service.range(user, { from: '2026-11-01', to: '2026-12-01' })).rejects.toThrow(
      /narrow the range/,
    );
  });
});

describe('CalendarService writes', () => {
  it('stores a new event in the home timezone with no exceptions', async () => {
    const { service, repo } = makeService('Asia/Tokyo');
    await service.create(user, write());
    expect(repo.create).toHaveBeenCalledWith(user, {
      event: write(),
      timeZone: 'Asia/Tokyo',
      exdates: [],
    });
  });

  it('refuses a rule it cannot expand, or one that never occurs', async () => {
    const { service, repo } = makeService();
    await expect(service.create(user, write({ rrule: 'FREQ=MINUTELY' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(user, write({ rrule: 'FREQ=DAILY;UNTIL=20260101T000000Z' })),
    ).rejects.toThrow(/never occurs/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('keeps skipped occurrences through an edit that keeps the slots', async () => {
    const { service, repo } = makeService();
    await service.replace(user, ID, write({ title: 'Swim (pool 2)' }));
    expect(repo.replace.mock.calls[0]?.[2].exdates).toEqual(weekly.exdates);
  });

  it('drops them when the rule, the start or the zone changes', async () => {
    const { service, repo } = makeService();
    await service.replace(user, ID, write({ startsAt: '2026-11-03T15:00:00.000Z' }));
    await service.replace(user, ID, write({ rrule: 'FREQ=DAILY' }));
    expect(repo.replace.mock.calls.map((call) => call[2].exdates)).toEqual([[], []]);

    const moved = makeService('Asia/Tokyo');
    await moved.service.replace(user, ID, write());
    expect(moved.repo.replace.mock.calls[0]?.[2]).toMatchObject({
      timeZone: 'Asia/Tokyo',
      exdates: [],
    });
  });

  it('404s a missing event', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    repo.delete.mockResolvedValue(false);
    await expect(service.get(user, ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.replace(user, ID, write())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(user, ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CalendarService.deleteOccurrence', () => {
  it('adds a real occurrence to the series’ exdates, normalising the key', async () => {
    const { service, repo } = makeService();
    await service.deleteOccurrence(user, ID, '2026-11-17T18:00:00+02:00');
    expect(repo.setExdates).toHaveBeenCalledWith(user, ID, [
      ...weekly.exdates,
      '2026-11-17T16:00:00.000Z',
    ]);
  });

  it('is idempotent for an occurrence already skipped', async () => {
    const { service, repo } = makeService();
    await service.deleteOccurrence(user, ID, '2026-11-10T16:00:00.000Z');
    expect(repo.setExdates).not.toHaveBeenCalled();
  });

  it('404s a start that is not an occurrence, and 400s a single event', async () => {
    const { service, repo } = makeService();
    await expect(
      service.deleteOccurrence(user, ID, '2026-11-17T17:00:00.000Z'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteOccurrence(user, ID, 'garbage')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    repo.findById.mockResolvedValue({ ...weekly, rrule: null });
    await expect(
      service.deleteOccurrence(user, ID, '2026-11-03T16:00:00.000Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
