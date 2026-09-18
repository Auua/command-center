import { Injectable, Logger } from '@nestjs/common';
import {
  LearningStateFileSchema,
  type DayPin,
  type LearningStateFile,
} from '@command-center/contracts';
import { VaultClient, VaultConflictError } from '../vault/vault.client';
import type { ProgressOverlay } from '../wotd/selection';

const STATE_PATH = '.cc/state.json';
const STATE_TTL_MS = 60 * 1000;

interface CachedState {
  file: LearningStateFile;
  sha: string | null;
  readAt: number;
}

function emptyState(): LearningStateFile {
  return { schemaVersion: 1, kinds: {} };
}

/**
 * The one app-owned vault file, `.cc/state.json` (day pins per kind), plus
 * the in-memory overlay of progress the API wrote since the index was last
 * generated (ADR-040). Both are sha-guarded on write; a lost race refetches
 * and reapplies once.
 */
@Injectable()
export class LearningStateService {
  private readonly logger = new Logger(LearningStateService.name);
  private cached: CachedState | null = null;
  private readonly overlay = new Map<string, ProgressOverlay>();

  constructor(private readonly vault: VaultClient) {}

  /** Current pins (cached ~60 s; the API is the only writer). */
  async readPins(force = false): Promise<LearningStateFile> {
    if (!force && this.cached && Date.now() - this.cached.readAt < STATE_TTL_MS) {
      return this.cached.file;
    }
    const file = await this.vault.getFileOrNull(STATE_PATH);
    if (!file) {
      this.cached = { file: emptyState(), sha: null, readAt: Date.now() };
      return this.cached.file;
    }
    let parsed: LearningStateFile;
    try {
      parsed = LearningStateFileSchema.parse(JSON.parse(file.content));
    } catch (error) {
      // Hand-edited into an invalid shape: degrade to no pins, never break the widget.
      this.logger.warn(
        `${STATE_PATH} is not valid; treating as empty: ${error instanceof Error ? error.message : String(error)}`,
      );
      parsed = emptyState();
    }
    this.cached = { file: parsed, sha: file.sha, readAt: Date.now() };
    return parsed;
  }

  /** Write one kind's pin, sha-guarded, retrying once on a lost race. */
  async writePin(kind: string, pin: DayPin): Promise<void> {
    await this.readPins();
    try {
      await this.put(kind, pin);
    } catch (error) {
      if (!(error instanceof VaultConflictError)) throw error;
      await this.readPins(true);
      await this.put(kind, pin);
    }
  }

  private async put(kind: string, pin: DayPin): Promise<void> {
    const base = this.cached?.file ?? emptyState();
    const next: LearningStateFile = { ...base, kinds: { ...base.kinds, [kind]: pin } };
    const content = `${JSON.stringify(next, null, 2)}\n`;
    const sha = await this.vault.putFile(
      STATE_PATH,
      content,
      this.cached?.sha ?? null,
      `cc: ${kind} pin ${pin.itemId}`,
    );
    this.cached = { file: next, sha, readAt: Date.now() };
  }

  /** Remember progress the API just wrote to a note. */
  recordWrite(path: string, progress: ProgressOverlay): void {
    this.overlay.set(path, progress);
  }

  overlayFor(path: string): ProgressOverlay | undefined {
    return this.overlay.get(path);
  }

  /** Drop overlay entries the (freshly loaded) index already reflects. */
  pruneOverlay(reflects: (path: string, progress: ProgressOverlay) => boolean): void {
    for (const [path, progress] of this.overlay) {
      if (reflects(path, progress)) this.overlay.delete(path);
    }
  }
}
