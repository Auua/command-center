import { Injectable } from '@nestjs/common';
import type { HealthResponse, TickStatus } from '@command-center/contracts';
import { SchedulerRepository } from '../scheduler/scheduler.repository';
import { SCHEDULER_NAME } from '../scheduler/scheduler.service';

/** A tick older than this reads as stale — the 1-min pinger has missed ≥ 5. */
const TICK_STALE_MS = 5 * 60 * 1000;

/**
 * Liveness + tick staleness (NFR-10, ADR-039): the external pinger is the
 * automation clock, so the probe reports how recently a tick landed and the
 * UptimeRobot keyword monitor watches for `"tick":"ok"`. A failing state
 * read degrades to `unknown` — the probe itself must never turn red because
 * the database is unreachable (that is its own alert).
 */
@Injectable()
export class HealthService {
  constructor(private readonly schedulerRepository: SchedulerRepository) {}

  async getHealth(): Promise<HealthResponse> {
    let tick: TickStatus = 'unknown';
    let lastTickAt: string | null = null;
    try {
      const state = await this.schedulerRepository.getState(SCHEDULER_NAME);
      if (!state?.lastTickAt) {
        tick = 'never';
      } else {
        lastTickAt = state.lastTickAt.toISOString();
        tick = Date.now() - state.lastTickAt.getTime() <= TICK_STALE_MS ? 'ok' : 'stale';
      }
    } catch {
      tick = 'unknown';
    }

    return {
      status: 'ok',
      service: 'api',
      time: new Date().toISOString(),
      tick,
      lastTickAt,
    };
  }
}
