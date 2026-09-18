import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationRepository } from '../notification/notification.repository';

export type LearningCondition =
  'token-invalid' | 'unavailable' | 'index-stale' | 'anki-sync-failed';

const TITLES: Record<LearningCondition, string> = {
  'token-invalid': 'Learning vault token expired',
  unavailable: 'Learning vault unreachable',
  'index-stale': 'Learning index is stale',
  'anki-sync-failed': 'Anki sync failed',
};

const BODIES: Record<LearningCondition, string> = {
  'token-invalid': 'GitHub rejected the vault token — rotate it (runbook step 4).',
  unavailable: 'The vault could not be read; showing the last good data if any.',
  'index-stale': 'The vault index is over 48 h old — check the cc-index workflow run.',
  'anki-sync-failed': 'The last anki-sync run went red — open the vault Actions tab.',
};

/** Index older than this raises `index-stale`. */
export const STALE_INDEX_MS = 48 * 60 * 60 * 1000;

/**
 * Learning-side failures reach the bell as `source: 'learning'` rows, at
 * most one open row per condition, raised when the condition is first
 * observed on a read (ADR-040). Best-effort: a failure to write the row is
 * logged and never breaks the read that observed the condition.
 */
@Injectable()
export class LearningAlertsService {
  private readonly logger = new Logger(LearningAlertsService.name);
  /** Per-process memo so a hot loop does not re-query the bell each read. */
  private readonly raised = new Map<string, number>();

  constructor(private readonly notifications: NotificationRepository) {}

  async raise(user: AuthenticatedUser, condition: LearningCondition): Promise<void> {
    const key = `${user.id}:${condition}`;
    const last = this.raised.get(key);
    if (last !== undefined && Date.now() - last < 6 * 60 * 60 * 1000) return;
    try {
      const open = await this.notifications.hasUnreadForUser(user, 'learning', TITLES[condition]);
      if (!open) {
        await this.notifications.insertForUser(user, {
          title: TITLES[condition],
          body: BODIES[condition],
          source: 'learning',
        });
      }
      this.raised.set(key, Date.now());
    } catch (error) {
      this.logger.warn(
        `Could not raise learning alert "${condition}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Forget the memo so a recovered-then-broken condition raises again. */
  clear(user: AuthenticatedUser, condition: LearningCondition): void {
    this.raised.delete(`${user.id}:${condition}`);
  }
}
