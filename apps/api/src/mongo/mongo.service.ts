import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { Env } from '../config/env';

/** Used when MONGODB_CONNECT carries no database name in its path. */
const DEFAULT_DB_NAME = 'command_center';

/** Extracts the database name from a mongodb(+srv):// URI path, if present. */
export function dbNameFromUri(uri: string): string | undefined {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri);
  const name = match?.[1]?.trim();
  return name ? decodeURIComponent(name) : undefined;
}

/**
 * Single MongoClient for the process (ARD §4.3 — Mongo is only ever reached
 * from the backend; ARD §5.1 — the connection string is a dedicated app user
 * scoped to this database).
 *
 * The client connects lazily on first operation, so the API still boots when
 * Atlas is unreachable and only Mongo-backed widgets degrade (ARD §2 failure
 * posture). Unlike Supabase there is no per-user client: user scoping is
 * enforced in code via UserScopedRepository.
 */
@Injectable()
export class MongoService implements OnApplicationShutdown {
  private readonly logger = new Logger(MongoService.name);
  private readonly client: MongoClient;
  private readonly db: Db;

  constructor(configService: ConfigService<Env, true>) {
    const uri = configService.get('MONGODB_CONNECT', { infer: true });
    this.client = new MongoClient(uri, {
      // Fail operations fast instead of stalling widget requests (NFR-2).
      serverSelectionTimeoutMS: 5_000,
    });
    this.db = this.client.db(dbNameFromUri(uri) ?? DEFAULT_DB_NAME);
  }

  collection<TDoc extends Document>(name: string): Collection<TDoc> {
    return this.db.collection<TDoc>(name);
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.close();
    } catch (error) {
      this.logger.warn(
        `Error closing MongoDB client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
