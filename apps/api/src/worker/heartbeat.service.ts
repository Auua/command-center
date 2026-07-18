import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Phase 0 worker stub: proves the second process (ADR §3.1 — same codebase,
 * separate entrypoint) by logging a heartbeat every 60s. The interval also
 * keeps the Node event loop alive.
 *
 * TODO(Phase 2): replace with pg-boss consumer + cron evaluation for
 * automations (ADR-005) and persist a worker heartbeat row (NFR-10).
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;

  onApplicationBootstrap(): void {
    this.logger.log('Worker started (Phase 0 stub — no job queue yet)');
    this.timer = setInterval(() => {
      const uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
      this.logger.log(`Worker heartbeat (uptime ${uptimeSeconds}s)`);
    }, HEARTBEAT_INTERVAL_MS);
  }

  onApplicationShutdown(signal?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log(`Worker shutting down${signal ? ` (${signal})` : ''}`);
  }
}
