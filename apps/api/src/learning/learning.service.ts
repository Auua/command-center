import { Injectable } from '@nestjs/common';
import type { VaultStatusResponse } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IndexCacheService } from './index/index-cache.service';
import { LearningAlertsService } from './learning-alerts.service';
import { VaultClient } from './vault/vault.client';

/** Cross-kind reads: the about panel's vault-status line (ADR-040). */
@Injectable()
export class LearningService {
  constructor(
    private readonly vault: VaultClient,
    private readonly index: IndexCacheService,
    private readonly alerts: LearningAlertsService,
  ) {}

  async vaultStatus(user: AuthenticatedUser): Promise<VaultStatusResponse> {
    if (!this.vault.configured) return { configured: false };
    const loaded = await this.index.get();
    const state = this.index.state;
    if (state === 'token-invalid') await this.alerts.raise(user, 'token-invalid');
    return {
      configured: true,
      state,
      indexedAt: loaded?.manifest.generatedAt ?? null,
      indexSha: loaded?.sha ?? null,
      counts: loaded?.manifest.counts ?? {},
      skipped: loaded?.manifest.skipped ?? {},
      errors: loaded?.manifest.errors ?? (this.index.lastFailure ? [this.index.lastFailure] : []),
      repoUrl: this.vault.repoUrl,
    };
  }
}
