import type {
  Collection,
  Document,
  Filter,
  FindOptions,
  IndexSpecification,
  MatchKeysAndValues,
  OptionalUnlessRequiredId,
  SearchIndexDescription,
  Sort,
  WithId,
} from 'mongodb';

/** The parts of an Atlas Search `compound` operator a repository supplies. */
export interface SearchCompound {
  must?: Document[];
  should?: Document[];
  filter?: Document[];
  minimumShouldMatch?: number;
}

/** An Atlas Search `$search` stage, minus the user scoping the base adds. */
export interface UserSearch {
  index: string;
  compound: SearchCompound;
  sort?: Record<string, 1 | -1>;
  highlight?: { path: string; maxNumPassages?: number };
}

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

  protected countForUser(userId: string, filter: Filter<TDoc> = {}): Promise<number> {
    return this.collection.countDocuments(this.scope(userId, filter));
  }

  /**
   * Runs an Atlas Search `$search` (which must be the first stage, so a
   * scoping `$match` cannot lead). The user is scoped twice: an `equals` on
   * `userId` inside the compound filter (the index maps `userId` as a
   * token), and a `$match` right after the search, so a search index that
   * lost its `userId` mapping returns nothing rather than another user's
   * entries. `stages` follow the scoping `$match`.
   */
  protected searchForUser(
    userId: string,
    search: UserSearch,
    stages: Document[] = [],
  ): Promise<Document[]> {
    const { compound, ...rest } = search;
    const pipeline: Document[] = [
      {
        $search: {
          ...rest,
          compound: {
            ...compound,
            filter: [...(compound.filter ?? []), { equals: { path: 'userId', value: userId } }],
          },
        },
      },
      { $match: { userId } },
      ...stages,
    ];
    return this.collection.aggregate(pipeline).toArray();
  }

  /** Atlas Search index management — collection-level, not user-scoped. */
  protected listSearchIndexes(name: string): Promise<Document[]> {
    return this.collection.listSearchIndexes(name).toArray();
  }

  protected createSearchIndex(description: SearchIndexDescription): Promise<string> {
    return this.collection.createSearchIndex(description);
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
