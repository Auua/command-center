import type {
  Collection,
  Document,
  Filter,
  FindOptions,
  IndexSpecification,
  MatchKeysAndValues,
  OptionalUnlessRequiredId,
  Sort,
  WithId,
} from 'mongodb';

/**
 * Every MongoDB document carries the owning user's id (ADR §4.4) — the
 * Supabase auth user UUID, stored as a plain string (opaque cross-DB
 * reference, ADR §4.3).
 */
export interface UserOwnedDocument extends Document {
  userId: string;
}

/**
 * Base class for all Mongo repositories (ADR §4.4): every query is filtered
 * on `userId` here, in one place. Subclasses never touch the collection
 * directly for reads/writes — they go through these protected helpers, so a
 * missing user filter is structurally impossible rather than a code-review
 * concern (ADR §5.1: user id comes from the verified JWT, never the body).
 */
export abstract class UserScopedRepository<TDoc extends UserOwnedDocument> {
  protected constructor(private readonly collection: Collection<TDoc>) {}

  private scope(userId: string, filter: Filter<TDoc> = {}): Filter<TDoc> {
    // userId is spread last so a caller-supplied filter can never widen it.
    return { ...filter, userId } as Filter<TDoc>;
  }

  protected findForUser(
    userId: string,
    filter: Filter<TDoc> = {},
    options: { sort?: Sort; limit?: number } = {},
  ): Promise<WithId<TDoc>[]> {
    const findOptions: FindOptions = {};
    if (options.sort) findOptions.sort = options.sort;
    if (options.limit) findOptions.limit = options.limit;
    return this.collection.find(this.scope(userId, filter), findOptions).toArray();
  }

  protected async insertForUser(userId: string, doc: Omit<TDoc, 'userId'>): Promise<WithId<TDoc>> {
    const stamped = { ...doc, userId } as OptionalUnlessRequiredId<TDoc>;
    const { insertedId } = await this.collection.insertOne(stamped);
    return { ...stamped, _id: insertedId } as WithId<TDoc>;
  }

  /** Returns the updated document, or null when no owned document matched. */
  protected updateOneForUser(
    userId: string,
    filter: Filter<TDoc>,
    set: MatchKeysAndValues<TDoc>,
  ): Promise<WithId<TDoc> | null> {
    return this.collection.findOneAndUpdate(
      this.scope(userId, filter),
      { $set: set },
      { returnDocument: 'after' },
    );
  }

  /** Index creation is a collection-level concern, not user-scoped. */
  protected createIndex(spec: IndexSpecification): Promise<string> {
    return this.collection.createIndex(spec);
  }

  /** Returns false when no owned document matched. */
  protected async deleteOneForUser(userId: string, filter: Filter<TDoc>): Promise<boolean> {
    const { deletedCount } = await this.collection.deleteOne(this.scope(userId, filter));
    return deletedCount > 0;
  }
}
