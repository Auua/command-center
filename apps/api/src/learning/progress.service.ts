import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileService } from '../profile/profile.service';
import { LearningStateService } from './state/learning-state.service';
import { applyProgress, readProgress, type FrontMatterProgress } from './vault/front-matter';
import { VaultClient, VaultConflictError } from './vault/vault.client';

/**
 * The one write path into a note (ADR-040): a front-matter-only edit,
 * sha-guarded with one refetch-and-retry, recorded in the overlay so reads
 * see it before the indexer does. `reviewed` carries the home-timezone
 * date (ADR-014's pace-on-UTC / record-on-home-time split).
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly vault: VaultClient,
    private readonly state: LearningStateService,
    private readonly profile: ProfileService,
  ) {}

  utcToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async homeDate(user: AuthenticatedUser): Promise<string> {
    const timezone = await this.profile.getTimezone(user);
    return DateTime.now().setZone(timezone).toISODate() ?? this.utcToday();
  }

  async readNoteProgress(path: string): Promise<FrontMatterProgress> {
    return readProgress((await this.vault.getFile(path)).content);
  }

  /** `kind`/`action` only shape the commit message: `cc: <kind> <action> <path>`. */
  async writeNote(
    kind: string,
    action: string,
    path: string,
    patch: { status?: string; confidence?: number; reviewed: string },
  ): Promise<void> {
    const attempt = async (): Promise<void> => {
      const file = await this.vault.getFile(path);
      const next = applyProgress(file.content, patch);
      if (next === file.content) return;
      await this.vault.putFile(path, next, file.sha, `cc: ${kind} ${action} ${path}`);
    };
    try {
      await attempt();
    } catch (error) {
      if (!(error instanceof VaultConflictError)) throw error;
      await attempt();
    }
    this.state.recordWrite(path, {
      status: patch.status ?? null,
      reviewed: patch.reviewed,
      confidence: patch.confidence ?? null,
    });
  }
}
