import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';

/**
 * Learning routes: auth tier, request validation, and the not-configured
 * contract. The e2e app boots without GITHUB_LEARNING_REPO/TOKEN, so every
 * read must answer `{ configured: false }` without touching GitHub — the
 * shape the widgets render as "not configured" (ADR-024/040).
 */
describe('Learning (e2e)', () => {
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
      await request(server).get('/api/v1/learning/wotd').expect(401);
      await request(server).get('/api/v1/learning/vault-status').expect(401);
      await request(server).get('/api/v1/learning/grammar/today').expect(401);
      await request(server).get('/api/v1/streaks').expect(401);
      await request(server)
        .post('/api/v1/learning/wotd/acknowledge')
        .send({ itemId: 'x.md' })
        .expect(401);
    });
  });

  describe('request validation (400s)', () => {
    it('rejects an unknown JLPT ceiling', async () => {
      await request(server).get('/api/v1/learning/wotd?ceiling=N9').set(asAnna).expect(400);
    });

    it('rejects a grammar action without itemId', async () => {
      await request(server)
        .post('/api/v1/learning/grammar/studied')
        .set(asAnna)
        .send({})
        .expect(400);
      await request(server).get('/api/v1/learning/grammar/today?ceiling=X').set(asAnna).expect(400);
    });

    it('rejects an acknowledge/skip body without itemId or with extra fields', async () => {
      await request(server)
        .post('/api/v1/learning/wotd/acknowledge')
        .set(asAnna)
        .send({})
        .expect(400);
      await request(server)
        .post('/api/v1/learning/wotd/skip')
        .set(asAnna)
        .send({ itemId: 'x.md', userId: 'someone' })
        .expect(400);
    });
  });

  describe('not configured (no vault env pair)', () => {
    it('answers configured: false on every read and action', async () => {
      await request(server)
        .get('/api/v1/learning/wotd')
        .set(asAnna)
        .expect(200)
        .expect({ configured: false });
      await request(server)
        .get('/api/v1/learning/vault-status')
        .set(asAnna)
        .expect(200)
        .expect({ configured: false });
      await request(server)
        .get('/api/v1/learning/grammar/today')
        .set(asAnna)
        .expect(200)
        .expect({ configured: false });
      await request(server)
        .post('/api/v1/learning/wotd/acknowledge')
        .set(asAnna)
        .send({ itemId: 'x.md' })
        .expect(201)
        .expect({ configured: false });
    });
  });
});
