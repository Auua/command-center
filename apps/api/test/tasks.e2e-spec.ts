import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';

/**
 * Tasks route guard + validation tier only. Unlike braindump (Mongo via
 * mongodb-memory-server), tasks live in Supabase Postgres, which the hermetic
 * e2e app can't reach — the placeholder SUPABASE_URL never resolves. Auth
 * (401) and request validation (400) both fire before any Postgres call, so
 * that tier is still covered end-to-end here; data behavior is covered by
 * unit tests against the repository seam.
 */
describe('Tasks (e2e)', () => {
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
      await request(server).get('/api/v1/tasks').expect(401);
      await request(server).post('/api/v1/tasks').send({ title: 'x' }).expect(401);
      await request(server).patch('/api/v1/tasks/some-id').send({ completed: true }).expect(401);
      await request(server).delete('/api/v1/tasks/some-id').expect(401);
    });

    it('rejects requests with an invalid token', async () => {
      await request(server)
        .get('/api/v1/tasks')
        .set('Authorization', 'Bearer forged-token')
        .expect(401);
    });
  });

  describe('request validation (400s, before any DB access)', () => {
    it('rejects an empty or missing title on create', async () => {
      await request(server).post('/api/v1/tasks').set(asAnna).send({}).expect(400);
      await request(server).post('/api/v1/tasks').set(asAnna).send({ title: '   ' }).expect(400);
    });

    it('rejects unknown top-level fields on create', async () => {
      await request(server)
        .post('/api/v1/tasks')
        .set(asAnna)
        .send({ title: 'x', userId: 'someone-else' })
        .expect(400);
    });

    it('rejects an out-of-range priority and a non-date deadline', async () => {
      await request(server)
        .post('/api/v1/tasks')
        .set(asAnna)
        .send({ title: 'x', priority: 9 })
        .expect(400);
      await request(server)
        .post('/api/v1/tasks')
        .set(asAnna)
        .send({ title: 'x', deadline: 'next tuesday' })
        .expect(400);
    });

    it('rejects an empty update', async () => {
      await request(server).patch('/api/v1/tasks/some-id').set(asAnna).send({}).expect(400);
    });
  });
});
