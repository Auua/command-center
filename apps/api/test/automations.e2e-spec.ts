import request from 'supertest';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { createE2eApp, E2E_TICK_SECRET, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';

const VALID_CREATE = {
  name: 'Hydration break',
  kind: 'recurring',
  schedule: { type: 'daily', time: '12:00' },
  action: { type: 'notify', title: 'Hydration break' },
};

/**
 * Phase 2 guard + validation tier (like tasks/mood: the hermetic app can't
 * reach Postgres, but 401s and contract 400s fire before any DB call), plus
 * the tick route's secret handling — the API's second non-JWT route.
 * SchedulerService is stubbed so a correct-secret tick can 204 without a
 * database; the scheduler pipeline itself is unit-tested.
 */
describe('Automations / notifications / profile / tick (e2e)', () => {
  let ctx: E2eContext;
  let server: Parameters<typeof request>[0];
  const tick = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

  beforeAll(async () => {
    ctx = await createE2eApp({
      overrides: [{ provide: SchedulerService, useValue: { tick } }],
    });
    server = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const asAnna = { Authorization: `Bearer ${tokenFor(ANNA)}` };

  describe('authentication (401 tier)', () => {
    it('rejects automation routes without a token', async () => {
      await request(server).get('/api/v1/automations').expect(401);
      await request(server).get('/api/v1/automations/today').expect(401);
      await request(server).get('/api/v1/automations/templates').expect(401);
      await request(server).get('/api/v1/automations/some-id/runs').expect(401);
      await request(server).post('/api/v1/automations').send(VALID_CREATE).expect(401);
      await request(server)
        .patch('/api/v1/automations/some-id')
        .send({ enabled: false })
        .expect(401);
      await request(server).delete('/api/v1/automations/some-id').expect(401);
    });

    it('rejects profile and notification routes without a token', async () => {
      await request(server).get('/api/v1/profile').expect(401);
      await request(server).put('/api/v1/profile').send({ timezone: 'UTC' }).expect(401);
      await request(server).get('/api/v1/notifications').expect(401);
      await request(server).post('/api/v1/notifications/read').send({ all: true }).expect(401);
      await request(server).post('/api/v1/notifications/subscriptions').send({}).expect(401);
      await request(server).delete('/api/v1/notifications/subscriptions').send({}).expect(401);
    });

    it('rejects a forged token', async () => {
      await request(server)
        .get('/api/v1/automations')
        .set('Authorization', 'Bearer forged-token')
        .expect(401);
    });
  });

  describe('request validation (400s, before any DB access)', () => {
    it('rejects kind/shape mismatches on create', async () => {
      // recurring without schedule
      await request(server)
        .post('/api/v1/automations')
        .set(asAnna)
        .send({ ...VALID_CREATE, schedule: undefined })
        .expect(400);
      // event without eventKey
      await request(server)
        .post('/api/v1/automations')
        .set(asAnna)
        .send({ name: 'n', kind: 'event', action: VALID_CREATE.action })
        .expect(400);
      // reserved kind "time" (D3)
      await request(server)
        .post('/api/v1/automations')
        .set(asAnna)
        .send({ ...VALID_CREATE, kind: 'time' })
        .expect(400);
    });

    it('rejects an off-list everyMinutes and unknown fields on create', async () => {
      await request(server)
        .post('/api/v1/automations')
        .set(asAnna)
        .send({ ...VALID_CREATE, schedule: { type: 'interval', everyMinutes: 7 } })
        .expect(400);
      await request(server)
        .post('/api/v1/automations')
        .set(asAnna)
        .send({ ...VALID_CREATE, userId: 'someone-else' })
        .expect(400);
    });

    it('rejects an empty patch and a malformed runs limit', async () => {
      await request(server).patch('/api/v1/automations/some-id').set(asAnna).send({}).expect(400);
      await request(server).get('/api/v1/automations/some-id/runs?limit=0').set(asAnna).expect(400);
      await request(server)
        .get('/api/v1/automations/some-id/runs?limit=abc')
        .set(asAnna)
        .expect(400);
    });

    it('rejects an invalid timezone on profile update', async () => {
      await request(server)
        .put('/api/v1/profile')
        .set(asAnna)
        .send({ timezone: 'Mars/Olympus' })
        .expect(400);
      await request(server)
        .put('/api/v1/profile')
        .set(asAnna)
        .send({ timezone: 'UTC', admin: true })
        .expect(400);
    });

    it('rejects a push endpoint off the known-host allowlist (SSRF gate)', async () => {
      await request(server)
        .post('/api/v1/notifications/subscriptions')
        .set(asAnna)
        .send({
          endpoint: 'https://internal.example.com/hook',
          keys: { p256dh: 'p', auth: 'a' },
        })
        .expect(400);
    });

    it('rejects a mark-read body with neither ids nor all (or both)', async () => {
      await request(server).post('/api/v1/notifications/read').set(asAnna).send({}).expect(400);
      await request(server)
        .post('/api/v1/notifications/read')
        .set(asAnna)
        .send({ ids: ['9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f'], all: true })
        .expect(400);
    });

    it('rejects a malformed ?limit= on the bell list', async () => {
      await request(server).get('/api/v1/notifications?limit=abc').set(asAnna).expect(400);
      await request(server).get('/api/v1/notifications?limit=101').set(asAnna).expect(400);
    });
  });

  describe('POST /api/v1/internal/tick (secret-guarded, non-JWT)', () => {
    beforeEach(() => {
      tick.mockClear();
    });

    it('rejects a missing secret with 401 and no body', async () => {
      const response = await request(server).post('/api/v1/internal/tick').expect(401);
      expect(response.text).toBe('');
      expect(tick).not.toHaveBeenCalled();
    });

    it('rejects a wrong secret with 401 and no body', async () => {
      const response = await request(server)
        .post('/api/v1/internal/tick')
        .set('x-tick-secret', 'wrong-secret')
        .expect(401);
      expect(response.text).toBe('');
      expect(tick).not.toHaveBeenCalled();
    });

    it('a user JWT is not a tick credential', async () => {
      await request(server).post('/api/v1/internal/tick').set(asAnna).expect(401);
      expect(tick).not.toHaveBeenCalled();
    });

    it('runs the tick with the correct secret: 204, empty body', async () => {
      const response = await request(server)
        .post('/api/v1/internal/tick')
        .set('x-tick-secret', E2E_TICK_SECRET)
        .expect(204);
      expect(response.text).toBe('');
      expect(tick).toHaveBeenCalledTimes(1);
    });

    it('ignores request input entirely (body cannot inject anything)', async () => {
      await request(server)
        .post('/api/v1/internal/tick?evil=1')
        .set('x-tick-secret', E2E_TICK_SECRET)
        .send({ cursorAt: '1970-01-01T00:00:00.000Z', userId: 'someone' })
        .expect(204);
      expect(tick).toHaveBeenCalledWith();
    });

    it('offers no GET route', async () => {
      await request(server)
        .get('/api/v1/internal/tick')
        .set('x-tick-secret', E2E_TICK_SECRET)
        .expect(404);
    });
  });
});
