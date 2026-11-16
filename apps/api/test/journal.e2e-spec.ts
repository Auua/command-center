import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  JOURNAL_ENTRY_CREATED_EVENT,
  JournalEntrySchema,
  JournalExportSchema,
  JournalListResponseSchema,
  JournalTodaySchema,
  type JournalDoc,
} from '@command-center/contracts';
import request from 'supertest';
import { StreaksService } from '../src/learning/streaks/streaks.service';
import { ProfileService } from '../src/profile/profile.service';
import { createE2eApp, tokenFor, type E2eContext } from './e2e-app';

const ANNA = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';

const doc = (...paragraphs: string[]): JournalDoc => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

/**
 * Journal (ADR-016) end to end against a real MongoDB: the allowlist, the
 * version check, the idempotent retry, the timeline cursor, the launcher
 * read and the export. The home timezone (Supabase) is stubbed, and the
 * streak listener is replaced so nothing reaches Postgres.
 */
describe('Journal (e2e)', () => {
  let ctx: E2eContext;
  let server: Parameters<typeof request>[0];
  const created: unknown[] = [];

  beforeAll(async () => {
    ctx = await createE2eApp({
      overrides: [
        {
          provide: ProfileService,
          useValue: { getTimezone: async (): Promise<string> => 'Europe/Helsinki' },
        },
        { provide: StreaksService, useValue: {} },
      ],
    });
    server = ctx.app.getHttpServer();
    ctx.app.get(EventEmitter2).on(JOURNAL_ENTRY_CREATED_EVENT, (event: unknown) => {
      created.push(event);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const asAnna = { Authorization: `Bearer ${tokenFor(ANNA)}` };
  const asOther = { Authorization: `Bearer ${tokenFor(OTHER)}` };

  it('rejects every route without a valid token', async () => {
    await request(server).get('/api/v1/journal/today').expect(401);
    await request(server).get('/api/v1/journal/entries').expect(401);
    await request(server)
      .post('/api/v1/journal/entries')
      .send({ doc: doc('x') })
      .expect(401);
    await request(server).get('/api/v1/journal/export').expect(401);
  });

  it('creates an entry with server-derived text, version 1, and emits the event', async () => {
    const response = await request(server)
      .post('/api/v1/journal/entries')
      .set(asAnna)
      .send({ entryDate: '2026-11-10', doc: doc('Quiet morning.', 'Long walk.'), tags: ['Rest'] })
      .expect(201);
    const entry = JournalEntrySchema.parse(response.body);
    expect(entry).toMatchObject({
      entryDate: '2026-11-10',
      textPreview: 'Quiet morning. Long walk.',
      wordCount: 4,
      tags: ['rest'],
      promptId: null,
      version: 1,
      schemaVersion: 1,
    });
    expect(created).toContainEqual(
      expect.objectContaining({ userId: ANNA, entryId: entry.id, entryDate: '2026-11-10' }),
    );
  });

  it('rejects docs outside the allowlist and client-derived fields', async () => {
    const post = (body: object): request.Test =>
      request(server).post('/api/v1/journal/entries').set(asAnna).send(body);
    await post({ doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] } }).expect(
      400,
    );
    await post({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:x' } }],
              },
            ],
          },
        ],
      },
    }).expect(400);
    await post({ doc: doc('x'), wordCount: 1000 }).expect(400);
    await post({ doc: doc('x'), entryDate: '10.11.2026' }).expect(400);
  });

  it('accepts an entry near the 256 kB cap (above Express’s 100 kB default)', async () => {
    await request(server)
      .post('/api/v1/journal/entries')
      .set(asAnna)
      .send({ entryDate: '2026-11-01', doc: doc('a'.repeat(200_000)) })
      .expect(201);
    await request(server)
      .post('/api/v1/journal/entries')
      .set(asAnna)
      .send({ doc: doc('a'.repeat(270_000)) })
      .expect(400);
  });

  it('autosaves on the edited version, retries idempotently, and 409s on a stale one', async () => {
    const first = JournalEntrySchema.parse(
      (
        await request(server)
          .post('/api/v1/journal/entries')
          .set(asAnna)
          .send({ entryDate: '2026-11-11', doc: doc('Draft') })
          .expect(201)
      ).body,
    );
    const path = `/api/v1/journal/entries/${first.id}`;

    const saved = await request(server)
      .patch(path)
      .set(asAnna)
      .send({ baseVersion: 1, doc: doc('Draft, longer now') })
      .expect(200);
    expect(saved.body).toMatchObject({
      version: 2,
      textPreview: 'Draft, longer now',
      wordCount: 3,
    });

    // The same request again (a retried timeout): already applied → 200, no new version.
    const retried = await request(server)
      .patch(path)
      .set(asAnna)
      .send({ baseVersion: 1, doc: doc('Draft, longer now') })
      .expect(200);
    expect(retried.body.version).toBe(2);

    // A different doc on the old version: someone else's edit is never overwritten.
    const conflict = await request(server)
      .patch(path)
      .set(asAnna)
      .send({ baseVersion: 1, doc: doc('From another tab') })
      .expect(409);
    expect(conflict.body.currentVersion).toBe(2);

    const tagged = await request(server)
      .patch(path)
      .set(asAnna)
      .send({ baseVersion: 2, tags: ['Work'] })
      .expect(200);
    expect(tagged.body).toMatchObject({
      version: 3,
      tags: ['work'],
      textPreview: 'Draft, longer now',
    });

    const read = await request(server).get(path).set(asAnna).expect(200);
    expect(JournalEntrySchema.parse(read.body).doc).toEqual(doc('Draft, longer now'));
  });

  it('keeps entries private: another user gets 404 for read, write and delete', async () => {
    const list = JournalListResponseSchema.parse(
      (await request(server).get('/api/v1/journal/entries').set(asAnna).expect(200)).body,
    );
    const id = list.items[0]?.id;
    expect(id).toBeDefined();
    const path = `/api/v1/journal/entries/${id}`;
    await request(server).get(path).set(asOther).expect(404);
    await request(server).patch(path).set(asOther).send({ baseVersion: 1, tags: [] }).expect(404);
    await request(server).delete(path).set(asOther).expect(404);
    await request(server).get('/api/v1/journal/entries/not-an-id').set(asAnna).expect(404);
    const others = await request(server).get('/api/v1/journal/entries').set(asOther).expect(200);
    expect(others.body.items).toEqual([]);
  });

  it('pages the timeline newest first and filters by date and tag', async () => {
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-03']) {
      await request(server)
        .post('/api/v1/journal/entries')
        .set(asOther)
        .send({ entryDate: day, doc: doc(day), tags: day === '2026-10-02' ? ['two'] : [] })
        .expect(201);
    }
    const page = async (query: string): Promise<{ dates: string[]; next: string | null }> => {
      const body = JournalListResponseSchema.parse(
        (await request(server).get(`/api/v1/journal/entries?${query}`).set(asOther).expect(200))
          .body,
      );
      return { dates: body.items.map((item) => item.entryDate), next: body.nextCursor };
    };

    const one = await page('limit=3');
    expect(one.dates).toEqual(['2026-10-03', '2026-10-02', '2026-10-02']);
    expect(one.next).not.toBeNull();
    const two = await page(`limit=3&cursor=${one.next}`);
    expect(two).toEqual({ dates: ['2026-10-01'], next: null });

    expect((await page('from=2026-10-02&to=2026-10-02')).dates).toHaveLength(2);
    expect((await page('tag=TWO')).dates).toEqual(['2026-10-02', '2026-10-02']);
    await request(server).get('/api/v1/journal/entries?cursor=bogus').set(asOther).expect(400);
    await request(server).get('/api/v1/journal/entries?sort=asc').set(asOther).expect(400);
  });

  it('answers the launcher with today’s date, a seeded prompt and today’s entry', async () => {
    const before = JournalTodaySchema.parse(
      (await request(server).get('/api/v1/journal/today').set(asAnna).expect(200)).body,
    );
    expect(before.prompt).not.toBeNull();
    expect(before.entry).toBeNull();
    expect(before.entriesToday).toBe(0);

    // No entryDate: the server dates it today in the home timezone.
    await request(server)
      .post('/api/v1/journal/entries')
      .set(asAnna)
      .send({ doc: doc('Today'), promptId: before.prompt?.id })
      .expect(201);
    const after = JournalTodaySchema.parse(
      (await request(server).get('/api/v1/journal/today').set(asAnna).expect(200)).body,
    );
    expect(after.date).toBe(before.date);
    expect(after.prompt).toEqual(before.prompt);
    expect(after.entry).toMatchObject({ entryDate: before.date, textPreview: 'Today' });
    expect(after.entriesToday).toBe(1);

    const growth = await request(server)
      .get('/api/v1/journal/today?categories=growth')
      .set(asAnna)
      .expect(200);
    expect(growth.body.prompt.id).toMatch(/^growth-/);
    await request(server).get('/api/v1/journal/today?categories=nope').set(asAnna).expect(400);
  });

  it('exports every entry with its doc and Markdown, and deletes for good', async () => {
    const exported = JournalExportSchema.parse(
      (await request(server).get('/api/v1/journal/export').set(asOther).expect(200)).body,
    );
    expect(exported.items).toHaveLength(4);
    expect(exported.items[0]?.markdown).toBe('2026-10-03');

    const id = exported.items[0]?.id;
    await request(server).delete(`/api/v1/journal/entries/${id}`).set(asOther).expect(204);
    await request(server).get(`/api/v1/journal/entries/${id}`).set(asOther).expect(404);
    await request(server).delete(`/api/v1/journal/entries/${id}`).set(asOther).expect(404);
  });
});
