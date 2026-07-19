import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import type {
  Automation,
  AutomationListResponse,
  AutomationRunListResponse,
  AutomationTemplateListResponse,
  CreateAutomationRequest,
  TodayEventAutomation,
  TodayResponse,
  TodayRun,
  TodaySlot,
  UpdateAutomationRequest,
} from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProfileService } from '../profile/profile.service';
import {
  AutomationRepository,
  type AutomationPatch,
  type RunSlotRow,
} from './automation.repository';
import { compileSchedule } from './schedule/schedule-compiler';
import { expandOccurrences } from './schedule/schedule-evaluator';
import { AUTOMATION_TEMPLATES } from './templates';

const TODAY_RUN_STATUSES = new Set(['sent', 'failed', 'skipped']);

/**
 * Business rules for automations (ADR-015). This service is the ONLY writer
 * of `cron_expr`: every create/update with a schedule compiles it here, so
 * the stored expression can never diverge from the descriptor the edit UI
 * round-trips. A malformed or foreign id is indistinguishable from a missing
 * one — both 404 (house rule, nothing leaks).
 */
@Injectable()
export class AutomationService {
  /** Clock seam for tests — "today" is computed from this. */
  now: () => Date = () => new Date();

  constructor(
    private readonly automationRepository: AutomationRepository,
    private readonly profileService: ProfileService,
  ) {}

  async listAutomations(user: AuthenticatedUser): Promise<AutomationListResponse> {
    const items = await this.automationRepository.listForUser(user);
    return { items };
  }

  createAutomation(user: AuthenticatedUser, request: CreateAutomationRequest): Promise<Automation> {
    if (request.kind === 'recurring') {
      return this.automationRepository.createForUser(user, {
        name: request.name,
        kind: 'recurring',
        schedule: request.schedule!,
        cron_expr: compileSchedule(request.schedule!),
        event_key: null,
        action: request.action,
        enabled: request.enabled,
      });
    }
    return this.automationRepository.createForUser(user, {
      name: request.name,
      kind: 'event',
      schedule: null,
      cron_expr: null,
      event_key: request.eventKey!,
      action: request.action,
      enabled: request.enabled,
    });
  }

  async updateAutomation(
    user: AuthenticatedUser,
    id: string,
    request: UpdateAutomationRequest,
  ): Promise<Automation> {
    const existing = await this.automationRepository.getForUser(user, id);
    if (!existing) {
      throw new NotFoundException(`Automation "${id}" not found`);
    }
    // kind is immutable; the fields must fit the automation's kind (the DB
    // CHECK would reject these too — this just turns them into clean 400s).
    if (request.schedule !== undefined && existing.kind !== 'recurring') {
      throw new BadRequestException('An event automation has no schedule');
    }
    if (request.eventKey !== undefined && existing.kind !== 'event') {
      throw new BadRequestException('A recurring automation has no eventKey');
    }

    const { schedule, eventKey, ...fields } = request;
    const patch: AutomationPatch & { event_key?: string } = { ...fields };
    if (schedule !== undefined) {
      patch.schedule = schedule;
      patch.cron_expr = compileSchedule(schedule);
    }
    if (eventKey !== undefined) {
      patch.event_key = eventKey;
    }

    const updated = await this.automationRepository.updateForUser(user, id, patch);
    if (!updated) {
      throw new NotFoundException(`Automation "${id}" not found`);
    }
    return updated;
  }

  async deleteAutomation(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.automationRepository.deleteForUser(user, id);
    if (!deleted) {
      throw new NotFoundException(`Automation "${id}" not found`);
    }
  }

  async listRuns(
    user: AuthenticatedUser,
    id: string,
    limit: number,
  ): Promise<AutomationRunListResponse> {
    const automation = await this.automationRepository.getForUser(user, id);
    if (!automation) {
      throw new NotFoundException(`Automation "${id}" not found`);
    }
    const items = await this.automationRepository.listRunsForAutomation(user, id, limit);
    return { items };
  }

  getTemplates(): AutomationTemplateListResponse {
    return { items: AUTOMATION_TEMPLATES };
  }

  /**
   * Server-side today expansion (ADR-015): every automation — enabled and
   * disabled — expanded in the user's stored timezone with the SAME
   * evaluator the tick uses, joined to today's run outcomes. `pending` never
   * surfaces (ADR-039: "no outcome yet" = no run field).
   */
  async getToday(user: AuthenticatedUser): Promise<TodayResponse> {
    const timezone = await this.profileService.getTimezone(user);
    const automations = await this.automationRepository.listForUser(user);

    const nowLocal = DateTime.fromJSDate(this.now(), { zone: timezone });
    const dayStart = nowLocal.startOf('day');
    const dayEnd = nowLocal.endOf('day');
    // (start, end] window: nudge the exclusive start so a 00:00 slot lands.
    const window = {
      start: new Date(dayStart.toMillis() - 1),
      end: dayEnd.toJSDate(),
    };

    const recurring = automations.filter((automation) => automation.kind === 'recurring');
    const events = automations.filter((automation) => automation.kind === 'event');

    const runs = await this.automationRepository.listRunsInWindow(user, window.start, window.end);
    const runBySlot = new Map<string, TodayRun>();
    for (const run of runs) {
      const mapped = toTodayRun(run);
      if (mapped) {
        runBySlot.set(`${run.automationId}|${run.slot}`, mapped);
      }
    }

    const slots: (TodaySlot & { utc: number })[] = [];
    for (const automation of recurring) {
      // schedule → cron via the same compiler that wrote cron_expr; the
      // service being the only cron writer makes them interchangeable.
      const cronExpr = compileSchedule(automation.schedule!);
      for (const occurrence of expandOccurrences(cronExpr, timezone, window)) {
        const slotIso = occurrence.toISOString();
        const run = runBySlot.get(`${automation.id}|${slotIso}`);
        slots.push({
          automationId: automation.id,
          name: automation.name,
          at: DateTime.fromJSDate(occurrence, { zone: timezone }).toISO() ?? slotIso,
          enabled: automation.enabled,
          ...(run ? { run } : {}),
          utc: occurrence.getTime(),
        });
      }
    }
    slots.sort((a, b) => a.utc - b.utc);

    const latestRuns = await this.automationRepository.listLatestRuns(
      user,
      events.map((automation) => automation.id),
    );
    const latestByAutomation = new Map(latestRuns.map((run) => [run.automationId, run]));

    const eventRows: TodayEventAutomation[] = events.map((automation) => {
      const lastRun = latestByAutomation.get(automation.id);
      const mapped = lastRun ? toTodayRun(lastRun) : undefined;
      return {
        automationId: automation.id,
        name: automation.name,
        eventKey: automation.eventKey!,
        enabled: automation.enabled,
        ...(mapped ? { lastRun: mapped } : {}),
      };
    });

    return {
      slots: slots.map(({ utc: _utc, ...slot }) => slot),
      events: eventRows,
    };
  }
}

function toTodayRun(run: RunSlotRow): TodayRun | undefined {
  if (!TODAY_RUN_STATUSES.has(run.status)) {
    return undefined; // pending → "no outcome yet"
  }
  return {
    status: run.status as TodayRun['status'],
    firedAt: run.firedAt,
  };
}
