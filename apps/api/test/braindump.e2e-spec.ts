import { BraindumpNoteSchema } from '@command-center/contracts';
import request from 'supertest';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';

describe('Braindump (e2e)', () => {
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
  const asOther = { Authorization: `Bearer ${tokenFor(OTHER)}` };

  describe('authentication', () => {
    it('rejects requests without a token', async () => {
      await request(server).get('/api/v1/braindump').expect(401);
      await request(server).post('/api/v1/braindump').send({ content: 'x' }).expect(401);
    });

    it('rejects requests with an invalid token', async () => {
      await request(server)
        .get('/api/v1/braindump')
        .set('Authorization', 'Bearer forged-token')
        .expect(401);
    });
  });

  describe('CRUD round-trip', () => {
    it('creates, lists, updates, and deletes a note', async () => {
      const created = await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: '  buy miso paste  ' })
        .expect(201);

      const note = BraindumpNoteSchema.parse(created.body);
      expect(note.content).toBe('buy miso paste'); // trimmed by the contract

      const listed = await request(server).get('/api/v1/braindump').set(asAnna).expect(200);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items[0].id).toBe(note.id);

      const updated = await request(server)
        .patch(`/api/v1/braindump/${note.id}`)
        .set(asAnna)
        .send({ content: 'buy miso paste and tofu' })
        .expect(200);
      expect(updated.body.content).toBe('buy miso paste and tofu');
      expect(updated.body.createdAt).toBe(note.createdAt);
      expect(Date.parse(updated.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(note.updatedAt));

      await request(server).delete(`/api/v1/braindump/${note.id}`).set(asAnna).expect(204);

      const afterDelete = await request(server).get('/api/v1/braindump').set(asAnna).expect(200);
      expect(afterDelete.body.items).toHaveLength(0);
    });

    it('lists notes newest first', async () => {
      await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: 'older' })
        .expect(201);
      const newer = await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: 'newer' })
        .expect(201);

      const listed = await request(server).get('/api/v1/braindump').set(asAnna).expect(200);

      expect(listed.body.items[0].id).toBe(newer.body.id);

      for (const item of listed.body.items) {
        await request(server).delete(`/api/v1/braindump/${item.id}`).set(asAnna).expect(204);
      }
    });
  });

  describe('validation', () => {
    it('rejects empty and whitespace-only content with a structured 400', async () => {
      const response = await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: '   ' })
        .expect(400);

      expect(response.body).toMatchObject({
        message: 'Validation failed',
        issues: expect.arrayContaining([expect.objectContaining({ path: 'content' })]),
      });
    });

    it('rejects unknown top-level fields (reject-unknown-fields)', async () => {
      await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: 'x', userId: OTHER })
        .expect(400);
    });

    it('404s on malformed note ids instead of leaking a Mongo error', async () => {
      await request(server)
        .patch('/api/v1/braindump/not-an-objectid')
        .set(asAnna)
        .send({ content: 'x' })
        .expect(404);
      await request(server).delete('/api/v1/braindump/not-an-objectid').set(asAnna).expect(404);
    });

    it('404s on well-formed but non-existent ids', async () => {
      await request(server)
        .delete('/api/v1/braindump/665f1e1e1e1e1e1e1e1e1e1e')
        .set(asAnna)
        .expect(404);
    });
  });

  describe('user isolation (ARD §5.1)', () => {
    it("never exposes one user's notes to another", async () => {
      const created = await request(server)
        .post('/api/v1/braindump')
        .set(asAnna)
        .send({ content: "anna's secret thought" })
        .expect(201);
      const noteId = created.body.id as string;

      // Other user sees an empty list…
      const otherList = await request(server).get('/api/v1/braindump').set(asOther).expect(200);
      expect(otherList.body.items).toHaveLength(0);

      // …and cannot update or delete Anna's note even with its real id.
      await request(server)
        .patch(`/api/v1/braindump/${noteId}`)
        .set(asOther)
        .send({ content: 'hijacked' })
        .expect(404);
      await request(server).delete(`/api/v1/braindump/${noteId}`).set(asOther).expect(404);

      // Anna still sees her note, unmodified.
      const annaList = await request(server).get('/api/v1/braindump').set(asAnna).expect(200);
      expect(annaList.body.items[0]).toMatchObject({
        id: noteId,
        content: "anna's secret thought",
      });

      await request(server).delete(`/api/v1/braindump/${noteId}`).set(asAnna).expect(204);
    });
  });
});
