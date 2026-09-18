import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  GRAMMAR_STUDIED_EVENT,
  STREAK_KEYS,
  TASK_COMPLETED_EVENT,
  WOTD_ACKNOWLEDGED_EVENT,
  type GrammarStudiedEvent,
  type StreakKey,
  type StreaksResponse,
  type TaskCompletedEvent,
  type WotdAcknowledgedEvent,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { EventContext } from '../../common/events/event-context';
import { ProfileService } from '../../profile/profile.service';
import {
  applyDay,
  effectiveCurrent,
  last7,
  last7Range,
  streakDateOf,
  streakToday,
} from './streak-math';
import { StreaksRepository } from './streaks.repository';

/**
 * StreaksService (ADR-014): subscribes to the domain events that count as
 * deliberate engagement and records one day mark per event, then updates
 * the read model. Adding a streak = one handler below; emitters never
 * change. Writes ride the emitting request's JWT (EventContext); an event
 * without context is logged and skipped rather than written unscoped.
 */
@Injectable()
export class StreaksService {
  private readonly logger = new Logger(StreaksService.name);

  constructor(
    private readonly repository: StreaksRepository,
    private readonly profile: ProfileService,
  ) {}

  @OnEvent(TASK_COMPLETED_EVENT)
  async onTaskCompleted(event: TaskCompletedEvent, context?: EventContext): Promise<void> {
    await this.record(context, 'tasks', event.completedAt);
  }

  @OnEvent(WOTD_ACKNOWLEDGED_EVENT)
  async onWotdAcknowledged(event: WotdAcknowledgedEvent, context?: EventContext): Promise<void> {
    await this.record(context, 'japanese-wotd', event.acknowledgedAt);
  }

  @OnEvent(GRAMMAR_STUDIED_EVENT)
  async onGrammarStudied(event: GrammarStudiedEvent, context?: EventContext): Promise<void> {
    await this.record(context, 'japanese-grammar', event.studiedAt);
  }

  /** Never throws: a streak failure must not fail the action that earned it. */
  async record(
    context: EventContext | undefined,
    streakKey: StreakKey,
    instantIso: string,
  ): Promise<void> {
    if (!context?.user) {
      this.logger.warn(`No request context for ${streakKey}; streak not recorded`);
      return;
    }
    const { user } = context;
    try {
      const timezone = await this.profile.getTimezone(user);
      const localDate = streakDateOf(instantIso, timezone);
      const inserted = await this.repository.insertDay(user, streakKey, localDate);
      if (!inserted) return;
      const next = applyDay(await this.repository.getRow(user, streakKey), localDate);
      if (next) await this.repository.upsertRow(user, streakKey, next);
    } catch (error) {
      this.logger.error(
        `Streak ${streakKey} not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getStreaks(user: AuthenticatedUser): Promise<StreaksResponse> {
    const timezone = await this.profile.getTimezone(user);
    const today = streakToday(timezone);
    const { from, to } = last7Range(today);
    const [rows, days] = await Promise.all([
      this.repository.listRows(user),
      this.repository.listDays(user, from, to),
    ]);
    const byKey = new Map(rows.map((row) => [row.streakKey, row]));
    const order = (key: string): number => {
      const index = (STREAK_KEYS as readonly string[]).indexOf(key);
      return index === -1 ? STREAK_KEYS.length : index;
    };
    const streaks = [...byKey.keys()]
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((key) => {
        const row = byKey.get(key);
        if (!row) throw new Error('unreachable');
        return {
          streakKey: key,
          currentLen: effectiveCurrent(row, today),
          bestLen: row.bestLen,
          lastActiveDate: row.lastActiveDate,
          activeToday: row.lastActiveDate === today,
          last7: last7(days.get(key) ?? new Set(), today),
        };
      });
    return { timezone, streaks };
  }
}
