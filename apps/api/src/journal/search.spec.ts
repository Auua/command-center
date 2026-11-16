import { ObjectId } from 'mongodb';
import { JournalRepository } from './journal.repository';
import type { MongoService } from '../mongo/mongo.service';
import {
  JOURNAL_SEARCH_DEFINITION,
  searchCompound,
  searchIndexState,
  toHighlights,
} from './search';

const USER = '00000000-0000-0000-0000-0000000000aa';
const ID = '6740a1b2c3d4e5f601234567';

describe('searchCompound', () => {
  it('requires every word of the query in the text or a tag', () => {
    expect(searchCompound({ q: 'heron lake' })).toEqual({
      must: [{ text: { query: 'heron lake', path: ['plainText', 'tags'], matchCriteria: 'all' } }],
      filter: [],
    });
  });

  it('filters by date range and tag without scoring them', () => {
    const { filter } = searchCompound({
      q: 'x',
      from: '2026-11-01',
      to: '2026-11-30',
      tag: 'rest',
    });
    expect(filter).toEqual([
      { range: { path: 'entryDate', gte: '2026-11-01', lte: '2026-11-30' } },
      { equals: { path: 'tags', value: 'rest' } },
    ]);
    expect(searchCompound({ q: 'x', to: '2026-11-30' }).filter).toEqual([
      { range: { path: 'entryDate', lte: '2026-11-30' } },
    ]);
  });

  it('continues strictly after the cursor position in (entryDate, _id) desc order', () => {
    const { filter } = searchCompound({ q: 'x', after: { entryDate: '2026-11-10', id: ID } });
    expect(filter).toEqual([
      {
        compound: {
          should: [
            { range: { path: 'entryDate', lt: '2026-11-10' } },
            {
              compound: {
                filter: [
                  { equals: { path: 'entryDate', value: '2026-11-10' } },
                  { range: { path: '_id', lt: new ObjectId(ID) } },
                ],
              },
            },
          ],
          minimumShouldMatch: 1,
        },
      },
    ]);
  });

  it('never carries the user — the repository base class adds it', () => {
    expect(JSON.stringify(searchCompound({ q: 'x', tag: 'y' }))).not.toContain('userId');
  });
});

describe('JOURNAL_SEARCH_DEFINITION', () => {
  it('maps every field the query filters, sorts or highlights on', () => {
    const fields = (JOURNAL_SEARCH_DEFINITION.mappings as { fields: Record<string, unknown> })
      .fields;
    expect(Object.keys(fields).sort()).toEqual(
      ['_id', 'entryDate', 'plainText', 'tags', 'userId'].sort(),
    );
    expect(fields.userId).toEqual({ type: 'token' });
    expect(fields.entryDate).toEqual({ type: 'token' });
    expect(fields.plainText).toMatchObject({ type: 'string' });
  });
});

describe('toHighlights', () => {
  it('keeps plainText passages with a hit, best first, as fragments', () => {
    expect(
      toHighlights([
        {
          path: 'plainText',
          score: 0.4,
          texts: [
            { value: 'Saw the ', type: 'text' },
            { value: 'heron', type: 'hit' },
          ],
        },
        { path: 'tags', score: 9, texts: [{ value: 'heron', type: 'hit' }] },
        {
          path: 'plainText',
          score: 0.9,
          texts: [
            { value: 'heron', type: 'hit' },
            { value: ' again', type: 'text' },
          ],
        },
        { path: 'plainText', score: 1, texts: [{ value: 'no hit here', type: 'text' }] },
      ]),
    ).toEqual([
      [
        { text: 'heron', hit: true },
        { text: ' again', hit: false },
      ],
      [
        { text: 'Saw the ', hit: false },
        { text: 'heron', hit: true },
      ],
    ]);
  });

  it('drops anything malformed instead of failing', () => {
    expect(toHighlights(undefined)).toEqual([]);
    expect(toHighlights([{ path: 'plainText', texts: 'nope' }, null].filter(Boolean))).toEqual([]);
  });
});

describe('searchIndexState', () => {
  it('reads $listSearchIndexes rows', () => {
    expect(searchIndexState([])).toBe('missing');
    expect(searchIndexState([{ status: 'READY', queryable: true }])).toBe('ready');
    expect(searchIndexState([{ status: 'STALE', queryable: true }])).toBe('ready');
    expect(searchIndexState([{ status: 'BUILDING', queryable: false }])).toBe('building');
    expect(searchIndexState([{ status: 'PENDING' }])).toBe('building');
    expect(searchIndexState([{ status: 'FAILED', queryable: false }])).toBe('failed');
  });
});

describe('JournalRepository.search', () => {
  function makeRepository(rows: unknown[]): { repo: JournalRepository; pipelines: unknown[][] } {
    const pipelines: unknown[][] = [];
    const collection = {
      aggregate: (pipeline: unknown[]): { toArray: () => Promise<unknown[]> } => {
        pipelines.push(pipeline);
        return { toArray: async (): Promise<unknown[]> => rows };
      },
    };
    const mongo = { collection: () => collection } as unknown as MongoService;
    return { repo: new JournalRepository(mongo), pipelines };
  }

  it('scopes the search to the user twice and returns summaries with highlights', async () => {
    const createdAt = new Date('2026-11-10T07:00:00.000Z');
    const { repo, pipelines } = makeRepository([
      {
        _id: new ObjectId(ID),
        userId: USER,
        entryDate: '2026-11-10',
        textPreview: 'Saw the heron',
        wordCount: 3,
        tags: [],
        promptId: null,
        version: 2,
        createdAt,
        updatedAt: createdAt,
        highlights: [{ path: 'plainText', score: 1, texts: [{ value: 'heron', type: 'hit' }] }],
      },
    ]);

    const hits = await repo.search(USER, { q: 'heron', tag: 'birds', limit: 20 });

    expect(hits).toEqual([
      {
        id: ID,
        entryDate: '2026-11-10',
        textPreview: 'Saw the heron',
        wordCount: 3,
        tags: [],
        promptId: null,
        version: 2,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        highlights: [[{ text: 'heron', hit: true }]],
      },
    ]);
    const [pipeline] = pipelines as [Record<string, unknown>[]];
    const search = pipeline[0]?.$search as {
      index: string;
      compound: { filter: unknown[] };
      sort: unknown;
      highlight: unknown;
    };
    expect(search.index).toBe('journal_search');
    expect(search.compound.filter).toEqual([
      { equals: { path: 'tags', value: 'birds' } },
      { equals: { path: 'userId', value: USER } },
    ]);
    expect(search.sort).toEqual({ entryDate: -1, _id: -1 });
    expect(search.highlight).toEqual({ path: 'plainText', maxNumPassages: 3 });
    expect(pipeline[1]).toEqual({ $match: { userId: USER } });
    expect(pipeline[2]).toEqual({ $limit: 21 });
    expect(pipeline).toContainEqual({ $project: { doc: 0, plainText: 0 } });
  });
});
