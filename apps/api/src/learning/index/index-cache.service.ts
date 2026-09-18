import { Injectable, Logger } from '@nestjs/common';
import {
  IndexManifestSchema,
  IndexRecordSchema,
  type IndexKind,
  type IndexManifest,
  type IndexRecord,
  type LearningState,
} from '@command-center/contracts';
import { VaultClient, VaultTokenInvalidError } from '../vault/vault.client';

/** One loaded `.cc/index` at a single commit sha (ADR-024's pinned refresh). */
export interface LoadedIndex {
  sha: string;
  manifest: IndexManifest;
  loadedAt: number;
  byPath: Map<string, IndexRecord>;
  byKind: Map<IndexKind, IndexRecord[]>;
  /** JSONL lines the contract rejected — skipped, counted, never fatal. */
  invalidLines: number;
}

const TTL_MS = 6 * 60 * 60 * 1000;
const MANIFEST_PATH = '.cc/index/manifest.json';

/**
 * In-memory index cache (ADR-024 as amended by ADR-040): manifest + shards
 * fetched at one sha, ~6 h TTL, refreshed stale-while-revalidate, served
 * stale forever on outage. A dead token is never hidden behind serve-stale:
 * it flips `state` to `token-invalid` until a call succeeds again.
 */
@Injectable()
export class IndexCacheService {
  private readonly logger = new Logger(IndexCacheService.name);
  private current: LoadedIndex | null = null;
  private inflight: Promise<LoadedIndex | null> | null = null;
  private tokenInvalid = false;
  private lastError: string | null = null;

  constructor(private readonly vault: VaultClient) {}

  get state(): LearningState {
    if (this.tokenInvalid) return 'token-invalid';
    return this.current ? 'ok' : 'unavailable';
  }

  get lastFailure(): string | null {
    return this.lastError;
  }

  /**
   * The index to serve: a cold cache awaits one load; a warm-but-expired
   * cache is returned immediately while a refresh runs in the background.
   * Null only when nothing has ever loaded.
   */
  async get(): Promise<LoadedIndex | null> {
    if (!this.vault.configured) return null;
    if (!this.current) {
      return this.refresh();
    }
    if (Date.now() - this.current.loadedAt > TTL_MS && !this.inflight) {
      void this.refresh();
    }
    return this.current;
  }

  /** Force a reload (coalesced with any in-flight one). */
  refresh(): Promise<LoadedIndex | null> {
    if (!this.inflight) {
      this.inflight = this.load()
        .then((loaded) => {
          this.current = loaded;
          this.tokenInvalid = false;
          this.lastError = null;
          return loaded;
        })
        .catch((error: unknown) => {
          if (error instanceof VaultTokenInvalidError) {
            this.tokenInvalid = true;
          }
          this.lastError = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Index refresh failed, serving ${this.current ? 'stale' : 'nothing'}: ${this.lastError}`,
          );
          return this.current;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  private async load(): Promise<LoadedIndex> {
    const sha = await this.vault.headSha();
    const manifestFile = await this.vault.getFile(MANIFEST_PATH, sha);
    const manifest = IndexManifestSchema.parse(JSON.parse(manifestFile.content));

    const byPath = new Map<string, IndexRecord>();
    const byKind = new Map<IndexKind, IndexRecord[]>();
    let invalidLines = 0;

    for (const shards of Object.values(manifest.shards)) {
      for (const shard of shards) {
        const file = await this.vault.getFile(`.cc/index/${shard}`, sha);
        for (const line of file.content.split('\n')) {
          if (line.trim() === '') continue;
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            invalidLines += 1;
            continue;
          }
          const parsed = IndexRecordSchema.safeParse(raw);
          if (!parsed.success) {
            invalidLines += 1;
            continue;
          }
          const record = parsed.data;
          byPath.set(record.path, record);
          const list = byKind.get(record.type) ?? [];
          list.push(record);
          byKind.set(record.type, list);
        }
      }
    }

    if (invalidLines > 0) {
      this.logger.warn(`Index at ${sha.slice(0, 8)}: ${invalidLines} line(s) skipped as invalid`);
    }
    this.logger.log(
      `Index loaded at ${sha.slice(0, 8)} (generated ${manifest.generatedAt}): ${byPath.size} notes`,
    );
    return { sha, manifest, loadedAt: Date.now(), byPath, byKind, invalidLines };
  }
}
