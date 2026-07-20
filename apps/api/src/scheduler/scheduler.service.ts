import { Injectable, Logger } from '@nestjs/common';
import { expandOccurrences } from '../automation/schedule/schedule-evaluator';
import { DispatchService } from './dispatch.service';
import { SchedulerRepository, type RecurringAutomation } from './scheduler.repository';

/** scheduler_state primary key for the automation tick. */
export const SCHEDULER_NAME = 'automation-tick';

/** First tick ever: look back one nominal tick interval, no further. */
const FIRST_RUN_LOOKBACK_MS = 60 * 1000;
/** Slots older than this are recorded `skipped`, never fired (ADR-039). */
const CATCH_UP_CAP_MS = 60 * 60 * 1000;
/** Pending runs older than this are re-processed (crashed invocation). */
const STALE_PENDING_MS = 5 * 60 * 1000;
/**
 * How far back skipped slots are still *recorded* after long downtime. The
 * cap bounds staleness of fires; this bounds the bookkeeping — after a week
 * of dead pinger, a day of honest `skipped` rows tells the story without
 * thousands of inserts.
 */
const SKIPPED_RECORD_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * The inline scheduler run (ADR-039): cursor window → evaluate → claim →
 * dispatch → advance, executed synchronously inside the tick invocation.
 * Overlap-safe purely through the claim rows — two concurrent ticks race
 * benignly (each slot has exactly one winner).
 *
 * Pure-testable: the clock is the injectable `now` seam and every effect
 * goes through SchedulerRepository/DispatchService.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  /** Clock seam for tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly schedulerRepository: SchedulerRepository,
    private readonly dispatchService: DispatchService,
  ) {}

  async tick(): Promise<void> {
    const now = this.now();

    // 1. Re-process pending runs a crashed invocation left behind. Runs
    //    claimed by this or an overlapping live tick are younger than the
    //    threshold and never match.
    const staleRuns = await this.schedulerRepository.listStalePendingRuns(
      new Date(now.getTime() - STALE_PENDING_MS),
    );
    for (const run of staleRuns) {
      await this.dispatchSafely(run.automationId, () => this.dispatchService.dispatchRun(run));
    }

    const state = await this.schedulerRepository.getState(SCHEDULER_NAME);
    const cursor = state?.cursorAt ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
    const capStart = new Date(now.getTime() - CATCH_UP_CAP_MS);
    const automations = await this.schedulerRepository.listEnabledRecurringAutomations();

    // 2. Slots older than the catch-up cap: recorded `skipped` — honest
    //    "didn't fire", no stale-push spray (ADR-039 step 6).
    if (cursor.getTime() < capStart.getTime()) {
      const skippedStart = new Date(
        Math.max(cursor.getTime(), now.getTime() - SKIPPED_RECORD_LOOKBACK_MS),
      );
      for (const automation of automations) {
        for (const slot of this.expandSafely(automation, skippedStart, capStart)) {
          await this.schedulerRepository.insertSkippedRun(automation.id, automation.userId, slot);
        }
      }
    }

    // 3. The live window (max(cursor, cap), now]: claim before send — no row
    //    returned means an overlapping tick owns the slot.
    const windowStart = cursor.getTime() > capStart.getTime() ? cursor : capStart;
    for (const automation of automations) {
      for (const slot of this.expandSafely(automation, windowStart, now)) {
        const runId = await this.schedulerRepository.claimRun(
          automation.id,
          automation.userId,
          slot,
        );
        if (runId === null) {
          continue;
        }
        await this.dispatchSafely(automation.id, () =>
          this.dispatchService.dispatchRun({
            runId,
            automationId: automation.id,
            userId: automation.userId,
            slot,
          }),
        );
      }
    }

    // 4. Advance the high-water mark; last_tick_at feeds /health staleness.
    await this.schedulerRepository.upsertState(SCHEDULER_NAME, now, now);
  }

  /** A malformed stored cron must never wedge the whole tick. */
  private expandSafely(automation: RecurringAutomation, start: Date, end: Date): Date[] {
    try {
      return expandOccurrences(automation.cronExpr, automation.timezone, { start, end });
    } catch (error) {
      this.logger.error(
        `Skipping automation ${automation.id}: cron expansion failed (${
          error instanceof Error ? error.message : 'unknown error'
        })`,
      );
      return [];
    }
  }

  /**
   * A failed dispatch leaves its run `pending` for the stale sweep and must
   * not abort the remaining slots or the cursor advance.
   */
  private async dispatchSafely(automationId: string, dispatch: () => Promise<void>): Promise<void> {
    try {
      await dispatch();
    } catch (error) {
      this.logger.error(
        `Dispatch for automation ${automationId} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
