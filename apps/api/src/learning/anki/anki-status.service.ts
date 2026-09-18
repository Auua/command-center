import { Injectable, Logger } from '@nestjs/common';
import {
  SyncStateFileSchema,
  type AnkiStatusResponse,
  type SyncStateFile,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { IndexCacheService } from '../index/index-cache.service';
import { LearningAlertsService } from '../learning-alerts.service';
import { VaultClient, VaultNotFoundError, VaultTokenInvalidError } from '../vault/vault.client';

const STATE_PATH = 'sync/state.json';
const NOTES_PATH = 'Japanese';
const BOT_AUTHOR = 'command-center[bot]';
const TTL_MS = 60 * 1000;

interface Cached {
  state: SyncStateFile | null;
  pending: number;
  readAt: number;
}

/**
 * The Anki status surface (ADR-026 as amended by ADR-040): one read composed
 * from the vault's `sync/state.json` (written only by the anki-sync Action)
 * plus a commits count for "N waiting for sync", both cached ~60 s. A failed
 * run surfaces in the bell as a learning alert.
 */
@Injectable()
export class AnkiStatusService {
  private readonly logger = new Logger(AnkiStatusService.name);
  private cached: Cached | null = null;

  constructor(
    private readonly vault: VaultClient,
    private readonly index: IndexCacheService,
    private readonly alerts: LearningAlertsService,
  ) {}

  async status(user: AuthenticatedUser): Promise<AnkiStatusResponse> {
    if (!this.vault.configured) return { configured: false };
    let snapshot: Cached;
    try {
      snapshot = await this.read();
    } catch (error) {
      const tokenInvalid = error instanceof VaultTokenInvalidError;
      this.logger.warn(
        `Anki status unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.alerts.raise(user, tokenInvalid ? 'token-invalid' : 'unavailable');
      return {
        configured: true,
        state: tokenInvalid ? 'token-invalid' : 'unavailable',
        lastSyncAt: null,
        lastRunStatus: 'never',
        lastRunUrl: null,
        pendingCommits: 0,
        decks: [],
        errors: [],
        actionsUrl: this.vault.actionsUrl,
      };
    }

    const state = snapshot.state;
    if (state?.lastRun.status === 'failed') {
      await this.alerts.raise(user, 'anki-sync-failed');
    } else {
      this.alerts.clear(user, 'anki-sync-failed');
    }
    return {
      configured: true,
      state: this.index.state === 'token-invalid' ? 'token-invalid' : 'ok',
      lastSyncAt: state?.lastSyncAt ?? null,
      lastRunStatus: state ? state.lastRun.status : 'never',
      lastRunUrl: state?.lastRun.url ?? null,
      pendingCommits: snapshot.pending,
      decks: (state?.decks ?? []).map((deck) => ({ name: deck.name, notes: deck.notes })),
      errors: state?.errors ?? [],
      actionsUrl: this.vault.actionsUrl,
    };
  }

  private async read(): Promise<Cached> {
    if (this.cached && Date.now() - this.cached.readAt < TTL_MS) return this.cached;
    let state: SyncStateFile | null = null;
    try {
      const file = await this.vault.getFile(STATE_PATH);
      state = SyncStateFileSchema.parse(JSON.parse(file.content));
    } catch (error) {
      if (!(error instanceof VaultNotFoundError)) throw error;
    }
    const pending = state?.lastSyncAt
      ? await this.vault.countCommitsSince(NOTES_PATH, state.lastSyncAt, BOT_AUTHOR)
      : 0;
    this.cached = { state, pending, readAt: Date.now() };
    return this.cached;
  }
}
