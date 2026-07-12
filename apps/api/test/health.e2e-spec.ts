import request from 'supertest';
import { createE2eApp, type E2eContext } from './e2e-app';

describe('Health (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health is public and reports ok', async () => {
    const response = await request(ctx.app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('does not serve /health under the API prefix', async () => {
    // The probe is excluded from /api/v1 (bootstrap.ts), so no route exists
    // there at all.
    await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(404);
  });
});
