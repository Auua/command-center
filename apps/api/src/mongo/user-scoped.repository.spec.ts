import { ObjectId, type Collection, type Filter, type Sort, type WithId } from 'mongodb';
import { UserScopedRepository, type UserOwnedDocument } from './user-scoped.repository';

interface TestDoc extends UserOwnedDocument {
  content: string;
}

/** Exposes the protected helpers so the scoping contract can be asserted. */
class TestRepository extends UserScopedRepository<TestDoc> {
  public constructor(collection: Collection<TestDoc>) {
    super(collection);
  }

  find(
    userId: string,
    filter?: Filter<TestDoc>,
    options?: { sort?: Sort; limit?: number },
  ): Promise<WithId<TestDoc>[]> {
    return this.findForUser(userId, filter, options);
  }
  insert(userId: string, doc: Omit<TestDoc, 'userId'>): Promise<WithId<TestDoc>> {
    return this.insertForUser(userId, doc);
  }
  update(
    userId: string,
    filter: Filter<TestDoc>,
    set: Partial<TestDoc>,
  ): Promise<WithId<TestDoc> | null> {
    return this.updateOneForUser(userId, filter, set);
  }
  delete(userId: string, filter: Filter<TestDoc>): Promise<boolean> {
    return this.deleteOneForUser(userId, filter);
  }
}

function makeCollectionStub(): {
  toArray: jest.Mock;
  collection: jest.Mocked<Collection<TestDoc>>;
} {
  const toArray = jest.fn().mockResolvedValue([]);
  return {
    toArray,
    collection: {
      find: jest.fn(() => ({ toArray })),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      createIndex: jest.fn().mockResolvedValue('idx'),
    } as unknown as jest.Mocked<Collection<TestDoc>>,
  };
}

const USER = 'user-a';
const INTRUDER = 'user-b';

describe('UserScopedRepository', () => {
  it('always includes userId in find filters', async () => {
    const { collection } = makeCollectionStub();
    const repo = new TestRepository(collection);

    await repo.find(USER, { content: 'x' }, { sort: { createdAt: -1 }, limit: 5 });

    expect(collection.find).toHaveBeenCalledWith(
      { content: 'x', userId: USER },
      { sort: { createdAt: -1 }, limit: 5 },
    );
  });

  it('does not let a caller-supplied filter widen the user scope', async () => {
    const { collection } = makeCollectionStub();
    const repo = new TestRepository(collection);

    // A filter that tries to smuggle in another user's id loses: the token
    // user id is applied last (ADR §5.1 — user id never comes from input).
    await repo.find(USER, { userId: INTRUDER } as Filter<TestDoc>);

    expect(collection.find).toHaveBeenCalledWith({ userId: USER }, {});
  });

  it('stamps userId onto inserted documents and returns the stored shape', async () => {
    const { collection } = makeCollectionStub();
    const repo = new TestRepository(collection);

    const result = await repo.insert(USER, { content: 'hello' } as Omit<TestDoc, 'userId'>);

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello', userId: USER }),
    );
    expect(result.userId).toBe(USER);
    expect(result._id).toBeInstanceOf(ObjectId);
  });

  it('scopes updates to the user and returns the post-update document', async () => {
    const { collection } = makeCollectionStub();
    const _id = new ObjectId();
    const updated = { _id, userId: USER, content: 'after' };
    (collection.findOneAndUpdate as jest.Mock).mockResolvedValue(updated);
    const repo = new TestRepository(collection);

    const result = await repo.update(USER, { _id }, { content: 'after' });

    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { _id, userId: USER },
      { $set: { content: 'after' } },
      { returnDocument: 'after' },
    );
    expect(result).toEqual(updated);
  });

  it('scopes deletes to the user and reports whether anything matched', async () => {
    const { collection } = makeCollectionStub();
    (collection.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });
    const repo = new TestRepository(collection);
    const _id = new ObjectId();

    await expect(repo.delete(USER, { _id })).resolves.toBe(true);
    expect(collection.deleteOne).toHaveBeenCalledWith({ _id, userId: USER });

    (collection.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 0 });
    await expect(repo.delete(USER, { _id })).resolves.toBe(false);
  });
});
