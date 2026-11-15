import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';

/**
 * Appreciation route guard + validation tier (ADR-017). Entries live in
 * Supabase Postgres, which the hermetic e2e app cannot reach; auth (401) and
 * request validation (400) both fire before any database call, so that tier
 * is covered end to end here and data behaviour by the unit specs.
 */
describe('Appreciation (e2e)', () => {
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

  it('rejects every route without a valid token', async () => {
    await request(server).get('/api/v1/appreciation').expect(401);
    await request(server).post('/api/v1/appreciation').send({ text: 'hi' }).expect(401);
    await request(server).delete('/api/v1/appreciation/some-id').expect(401);
    await request(server).get('/api/v1/appreciation/export').expect(401);
    await request(server).get('/api/v1/appreciation/prompts/today').expect(401);
    await request(server)
      .get('/api/v1/appreciation')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);
  });

  it('rejects blank, too long or over-tagged entries', async () => {
    const post = (body: unknown): request.Test =>
      request(server)
        .post('/api/v1/appreciation')
        .set(asAnna)
        .send(body as object);
    await post({}).expect(400);
    await post({ text: '   ' }).expect(400);
    await post({ text: 'x'.repeat(281) }).expect(400);
    await post({ text: 'ok', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).expect(400);
  });

  it('rejects unknown fields on create', async () => {
    await request(server)
      .post('/api/v1/appreciation')
      .set(asAnna)
      .send({ text: 'ok', userId: 'someone-else' })
      .expect(400);
  });

  it('rejects a malformed ?limit= and an unknown ?locale=', async () => {
    await request(server).get('/api/v1/appreciation?limit=0').set(asAnna).expect(400);
    await request(server).get('/api/v1/appreciation?limit=abc').set(asAnna).expect(400);
    await request(server).get('/api/v1/appreciation?limit=51').set(asAnna).expect(400);
    await request(server)
      .get('/api/v1/appreciation/prompts/today?locale=de')
      .set(asAnna)
      .expect(400);
  });
});
