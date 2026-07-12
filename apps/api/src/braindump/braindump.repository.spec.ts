import { BraindumpNoteSchema } from '@command-center/contracts';
import { ObjectId } from 'mongodb';
import type { MongoService } from '../mongo/mongo.service';
import { BraindumpRepository } from './braindump.repository';

const USER = '00000000-0000-0000-0000-000000000001';

function makeCollectionStub(): {
  collection: {
    find: jest.Mock;
    insertOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
    createIndex: jest.Mock;
  };
  toArray: jest.Mock;
} {
  const toArray = jest.fn().mockResolvedValue([]);
  const collection = {
    find: jest.fn(() => ({ toArray })),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    createIndex: jest.fn().mockResolvedValue('idx'),
  };
  return { collection, toArray };
}

function makeRepository(collection: unknown): BraindumpRepository {
  const mongoService = {
    collection: jest.fn().mockReturnValue(collection),
  } as unknown as MongoService;
  return new BraindumpRepository(mongoService);
}

describe('BraindumpRepository', () => {
  it("lists the user's notes newest-first and maps them to the contract", async () => {
    const { collection, toArray } = makeCollectionStub();
    const _id = new ObjectId();
    const createdAt = new Date('2026-07-11T10:00:00.000Z');
    toArray.mockResolvedValue([
      { _id, userId: USER, content: 'note', createdAt, updatedAt: createdAt },
    ]);
    const repo = makeRepository(collection);

    const notes = await repo.listForUser(USER);

    expect(collection.find).toHaveBeenCalledWith(
      { userId: USER },
      { sort: { createdAt: -1 }, limit: 200 },
    );
    expect(notes).toEqual([
      {
        id: _id.toHexString(),
        content: 'note',
        createdAt: '2026-07-11T10:00:00.000Z',
        updatedAt: '2026-07-11T10:00:00.000Z',
      },
    ]);
    expect(() => BraindumpNoteSchema.parse(notes[0])).not.toThrow();
  });

  it('creates a note stamped with the user id and both timestamps', async () => {
    const { collection } = makeCollectionStub();
    const repo = makeRepository(collection);

    const note = await repo.createForUser(USER, 'fresh thought');

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        content: 'fresh thought',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(() => BraindumpNoteSchema.parse(note)).not.toThrow();
    expect(note.content).toBe('fresh thought');
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it('returns the updated note when the user owns it', async () => {
    const { collection } = makeCollectionStub();
    const _id = new ObjectId();
    const now = new Date();
    collection.findOneAndUpdate.mockResolvedValue({
      _id,
      userId: USER,
      content: 'updated',
      createdAt: now,
      updatedAt: now,
    });
    const repo = makeRepository(collection);

    const note = await repo.updateContentForUser(USER, _id.toHexString(), 'updated');

    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { _id, userId: USER },
      { $set: { content: 'updated', updatedAt: expect.any(Date) } },
      { returnDocument: 'after' },
    );
    expect(note?.content).toBe('updated');
  });

  it('short-circuits malformed ids without querying MongoDB', async () => {
    const { collection } = makeCollectionStub();
    const repo = makeRepository(collection);

    await expect(repo.updateContentForUser(USER, 'not-an-objectid', 'x')).resolves.toBeNull();
    await expect(repo.deleteForUser(USER, 'not-an-objectid')).resolves.toBe(false);

    expect(collection.findOneAndUpdate).not.toHaveBeenCalled();
    expect(collection.deleteOne).not.toHaveBeenCalled();
  });

  it('reports delete success only when an owned document matched', async () => {
    const { collection } = makeCollectionStub();
    collection.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const repo = makeRepository(collection);
    const id = new ObjectId().toHexString();

    await expect(repo.deleteForUser(USER, id)).resolves.toBe(true);

    collection.deleteOne.mockResolvedValue({ deletedCount: 0 });
    await expect(repo.deleteForUser(USER, id)).resolves.toBe(false);
  });

  it('ensures the list index on module init', async () => {
    const { collection } = makeCollectionStub();
    const repo = makeRepository(collection);

    await repo.onModuleInit();

    expect(collection.createIndex).toHaveBeenCalledWith({
      userId: 1,
      createdAt: -1,
    });
  });

  it('boots even when index creation fails (MongoDB down)', async () => {
    const { collection } = makeCollectionStub();
    collection.createIndex.mockRejectedValue(new Error('ECONNREFUSED'));
    const repo = makeRepository(collection);

    await expect(repo.onModuleInit()).resolves.toBeUndefined();
  });
});
