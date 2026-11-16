import { InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { SupabaseService } from '../supabase/supabase.service';
import { CalendarRepository } from './calendar.repository';

const user: AuthenticatedUser = { id: '00000000-0000-0000-0000-000000000001', token: 'jwt' };
const ID = '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e';

/** Chainable stub for the supabase-js query builder (a thenable). */
function chain(result: {
  data?: unknown;
  error: { message: string; code?: string } | null;
}): Record<string, jest.Mock> & { then: unknown } {
  const c: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'not',
    'lt',
    'gt',
    'gte',
    'insert',
    'update',
    'delete',
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

function makeRepository(...chains: Record<string, unknown>[]): CalendarRepository {
  const from = jest.fn();
  for (const c of chains) from.mockReturnValueOnce(c);
  return new CalendarRepository({
    forUser: jest.fn().mockReturnValue({ from }),
  } as unknown as SupabaseService);
}

const timedRow = {
  id: ID,
  title: 'Dentist',
  location: null,
  note: null,
  rrule: null,
  exdates: null,
  time_zone: 'Europe/Helsinki',
  all_day: false,
  starts_at: '2026-11-20T08:00:00+00:00',
  ends_at: '2026-11-20T09:00:00+00:00',
  starts_on: null,
  ends_on: null,
  created_at: '2026-11-01T10:00:00+00:00',
  updated_at: '2026-11-01T10:00:00+00:00',
};
const allDayRow = {
  ...timedRow,
  id: '8e4d1b9f-6b9b-4d2c-8e4f-2a3b4c5d6e7f',
  all_day: true,
  starts_at: null,
  ends_at: null,
  starts_on: '2026-07-14',
  ends_on: '2026-07-14',
  rrule: 'FREQ=YEARLY',
};

const RANGE = {
  startsBefore: '2026-11-30T22:00:00.000Z',
  endsAfter: '2026-10-31T22:00:00.000Z',
  fromDate: '2026-11-01',
  toDate: '2026-12-01',
};

describe('CalendarRepository', () => {
  it('reads timed and all-day rows into the two contract shapes', async () => {
    const timed = chain({ data: [timedRow], error: null });
    const allDay = chain({ data: [], error: null });
    const series = chain({ data: [allDayRow], error: null });
    const events = await makeRepository(timed, allDay, series).listForRange(user, RANGE);

    expect(timed.eq).toHaveBeenCalledWith('user_id', user.id);
    expect(timed.lt).toHaveBeenCalledWith('starts_at', RANGE.startsBefore);
    expect(timed.gt).toHaveBeenCalledWith('ends_at', RANGE.endsAfter);
    expect(allDay.lt).toHaveBeenCalledWith('starts_on', '2026-12-01');
    expect(allDay.gte).toHaveBeenCalledWith('ends_on', '2026-11-01');
    expect(series.not).toHaveBeenCalledWith('rrule', 'is', null);
    expect(events).toEqual([
      expect.objectContaining({
        id: ID,
        allDay: false,
        startsAt: '2026-11-20T08:00:00.000Z',
        endsAt: '2026-11-20T09:00:00.000Z',
        exdates: [],
        timeZone: 'Europe/Helsinki',
      }),
      expect.objectContaining({ allDay: true, startsOn: '2026-07-14', rrule: 'FREQ=YEARLY' }),
    ]);
    expect(events[0]).not.toHaveProperty('startsOn');
  });

  it('leaves out a series that starts after the range', async () => {
    const later = { ...allDayRow, starts_on: '2027-01-01', ends_on: '2027-01-01' };
    const events = await makeRepository(
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [later], error: null }),
    ).listForRange(user, RANGE);
    expect(events).toEqual([]);
  });

  it('writes the representation that matches allDay, nulling the other', async () => {
    const insert = chain({ data: allDayRow, error: null });
    await makeRepository(insert).create(user, {
      event: {
        allDay: true,
        title: 'Birthday',
        startsOn: '2026-07-14',
        endsOn: '2026-07-14',
        location: null,
        note: null,
        rrule: 'FREQ=YEARLY',
      },
      timeZone: 'Europe/Helsinki',
      exdates: [],
    });
    expect(insert.insert).toHaveBeenCalledWith({
      user_id: user.id,
      title: 'Birthday',
      location: null,
      note: null,
      rrule: 'FREQ=YEARLY',
      exdates: [],
      time_zone: 'Europe/Helsinki',
      all_day: true,
      starts_at: null,
      ends_at: null,
      starts_on: '2026-07-14',
      ends_on: '2026-07-14',
    });
  });

  it('treats a malformed id as missing, and other failures as 500s', async () => {
    expect(
      await makeRepository(chain({ error: { message: 'bad uuid', code: '22P02' } })).findById(
        user,
        'nope',
      ),
    ).toBeNull();
    await expect(
      makeRepository(
        chain({ data: [], error: null }),
        chain({ error: { message: 'boom' } }),
        chain({ data: [], error: null }),
      ).listForRange(user, RANGE),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('refuses a stored row that breaks the contract', async () => {
    const broken = { ...timedRow, starts_at: null };
    await expect(
      makeRepository(chain({ data: broken, error: null })).findById(user, ID),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
