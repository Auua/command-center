import { Injectable, Logger } from '@nestjs/common';
import type { EventKey } from '@command-center/contracts';
import { WebPushService } from '../notification/web-push.service';
import { SchedulerRepository, type PendingRun } from './scheduler.repository';

/**
 * The claim → bell → push → status tail (ADR-039 step 5), shared verbatim by
 * the tick (recurring slots + stale-pending re-process) and the
 * task-completed listener (event automations) — one dispatch semantics.
 *
 * Status rules:
 * - automation deleted/disabled since expansion → `skipped` (honest, no fire)
 * - bell row written and (no subscriptions OR ≥ 1 push accepted) → `sent`
 * - otherwise → `failed` (+ error) — the bell row, when written, still
 *   exists: it is the delivery of record regardless of push outcome.
 * Dead endpoints (404/410) are pruned inline.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  /** Clock seam for tests — dispatch stamps fired_at through this. */
  now: () => Date = () => new Date();

  constructor(
    private readonly schedulerRepository: SchedulerRepository,
    private readonly webPushService: WebPushService,
  ) {}

  async dispatchRun(run: PendingRun): Promise<void> {
    const automation = await this.schedulerRepository.getAutomationForDispatch(run.automationId);
    if (!automation) {
      await this.schedulerRepository.updateRunStatus(
        run.runId,
        'skipped',
        null,
        'automation deleted before fire',
      );
      return;
    }
    if (!automation.enabled) {
      // Disabled between expansion and fire — ADR-015's "paused from next
      // occurrence" copy documents the race; the run records the skip.
      await this.schedulerRepository.updateRunStatus(run.runId, 'skipped', null, null);
      return;
    }

    let notificationId: string;
    try {
      notificationId = await this.schedulerRepository.insertNotification(
        automation.userId,
        automation.action.title,
        automation.action.body,
        automation.id,
      );
    } catch (error) {
      // No bell row means nothing was delivered — never push without the
      // record of delivery (the bell IS the delivery of record).
      await this.schedulerRepository.updateRunStatus(
        run.runId,
        'failed',
        this.now(),
        `bell write failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }

    const subscriptions = await this.schedulerRepository.listSubscriptions(automation.userId);
    const payload = JSON.stringify({
      title: automation.action.title,
      body: automation.action.body,
      notificationId,
      automationId: automation.id,
      slot: run.slot.toISOString(),
    });

    let accepted = 0;
    let failed = 0;
    for (const subscription of subscriptions) {
      const outcome = await this.webPushService.send(subscription, payload);
      if (outcome === 'accepted') {
        accepted += 1;
      } else if (outcome === 'gone') {
        await this.schedulerRepository.deleteSubscriptionById(subscription.id);
      } else {
        failed += 1;
      }
    }

    const sent = subscriptions.length === 0 || accepted >= 1;
    await this.schedulerRepository.updateRunStatus(
      run.runId,
      sent ? 'sent' : 'failed',
      this.now(),
      sent ? null : `all ${failed} push sends failed`,
    );
  }

  /**
   * Inline event dispatch ("after finishing a task" gets faster, not
   * slower — ADR-039): claim with slot = the event timestamp, then the same
   * tail. A slot already claimed (duplicate event) is silently skipped.
   */
  async dispatchEventAutomations(
    userId: string,
    eventKey: EventKey,
    occurredAt: Date,
  ): Promise<void> {
    const automations = await this.schedulerRepository.listEnabledEventAutomations(
      userId,
      eventKey,
    );
    for (const automation of automations) {
      const runId = await this.schedulerRepository.claimRun(automation.id, userId, occurredAt);
      if (runId === null) {
        continue;
      }
      try {
        await this.dispatchRun({
          runId,
          automationId: automation.id,
          userId,
          slot: occurredAt,
        });
      } catch (error) {
        // Leave the run pending — the tick's stale sweep retries it.
        this.logger.error(
          `Event dispatch for automation ${automation.id} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }
}
