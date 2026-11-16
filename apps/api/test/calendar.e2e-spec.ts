import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';
const ID = '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e';

/**
 * Calendar route guard + validation tier (ADR-018). Events live in Supabase
 * Postgres, which the hermetic e2e app cannot reach; auth (401) and request
 * validation (400) both fire before any database call, so that tier is
 * covered end to end here, and data behaviour by the unit specs.
 */
describe('Calendar (e2e)', () => {
  let ctx: E2eContext;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    ctx = await createE2eApp();
    server = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const asAnna = { Authorization: `Bearer ${tokenFor(ANNA)}` };
  const timed = {
    allDay: false,
    title: 'Dentist',
    startsAt: '2026-11-20T08:00:00.000Z',
    endsAt: '2026-11-20T09:00:00.000Z',
  };

  it('rejects every route without a valid token', async () => {
    await request(server).get('/api/v1/calendar/events?from=2026-11-01&to=2026-12-01').expect(401);
    await request(server).get(`/api/v1/calendar/events/${ID}`).expect(401);
    await request(server).post('/api/v1/calendar/events').send(timed).expect(401);
    await request(server).patch(`/api/v1/calendar/events/${ID}`).send(timed).expect(401);
    await request(server).delete(`/api/v1/calendar/events/${ID}`).expect(401);
    await request(server)
      .delete(`/api/v1/calendar/events/${ID}/occurrences/2026-11-20`)
      .expect(401);
  });

  it('requires a bounded date range', async () => {
    const get = (query: string): request.Test =>
      request(server).get(`/api/v1/calendar/events${query}`).set(asAnna);
    await get('').expect(400);
    await get('?from=2026-11-01').expect(400);
    await get('?from=2026-11-01&to=2026-11-01').expect(400);
    await get('?from=2026-01-01&to=2027-01-03').expect(400);
    await get('?from=2026-11-01T00:00:00Z&to=2026-12-01').expect(400);
    await get('?from=2026-11-01&to=2026-12-01&extra=1').expect(400);
  });

  it('rejects malformed events before touching the database', async () => {
    const post = (body: unknown): request.Test =>
      request(server)
        .post('/api/v1/calendar/events')
        .set(asAnna)
        .send(body as object);
    await post({}).expect(400);
    await post({ ...timed, title: ' ' }).expect(400);
    await post({ ...timed, endsAt: timed.startsAt }).expect(400);
    await post({ ...timed, userId: 'someone-else' }).expect(400);
    await post({ allDay: true, title: 'x', startsOn: '2026-07-14' }).expect(400);
    await post({ ...timed, startsOn: '2026-07-14' }).expect(400);
    await post({ ...timed, rrule: 'x'.repeat(301) }).expect(400);
    await request(server)
      .patch(`/api/v1/calendar/events/${ID}`)
      .set(asAnna)
      .send({ title: 'only a title' })
      .expect(400);
  });
});
