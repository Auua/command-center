import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';

/**
 * Mood route guard + validation tier only. Like tasks, mood check-ins live
 * in Supabase Postgres, which the hermetic e2e app can't reach — the
 * placeholder SUPABASE_URL never resolves. Auth (401) and request validation
 * (400) both fire before any Postgres call, so that tier is still covered
 * end-to-end here; data behavior is covered by unit tests against the
 * repository seam.
 */
describe('Mood (e2e)', () => {
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

  describe('authentication', () => {
    it('rejects requests without a token', async () => {
      await request(server).get('/api/v1/mood').expect(401);
      await request(server).post('/api/v1/mood').send({ score: 4 }).expect(401);
      await request(server).delete('/api/v1/mood/some-id').expect(401);
    });

    it('rejects requests with an invalid token', async () => {
      await request(server)
        .get('/api/v1/mood')
        .set('Authorization', 'Bearer forged-token')
        .expect(401);
    });
  });

  describe('request validation (400s, before any DB access)', () => {
    it('rejects a missing or out-of-range score on create', async () => {
      await request(server).post('/api/v1/mood').set(asAnna).send({}).expect(400);
      await request(server)
        .post('/api/v1/mood')
        .set(asAnna)
        .send({ score: 9 })
        .expect(400);
      await request(server)
        .post('/api/v1/mood')
        .set(asAnna)
        .send({ score: 3.5 })
        .expect(400);
    });

    it('rejects unknown top-level fields on create', async () => {
      await request(server)
        .post('/api/v1/mood')
        .set(asAnna)
        .send({ score: 4, userId: 'someone-else' })
        .expect(400);
    });

    it('rejects a malformed ?days= window on list', async () => {
      await request(server).get('/api/v1/mood?days=abc').set(asAnna).expect(400);
      await request(server).get('/api/v1/mood?days=0').set(asAnna).expect(400);
      await request(server).get('/api/v1/mood?days=365').set(asAnna).expect(400);
    });
  });
});
