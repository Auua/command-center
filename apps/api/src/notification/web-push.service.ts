import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webPush, { WebPushError } from 'web-push';
import type { Env } from '../config/env';

/** Outcome of one push send. `gone` means the subscription is dead (404/410
 * from the push service) and must be pruned by the caller. */
export type PushSendOutcome = 'accepted' | 'gone' | 'failed';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Thin wrapper over the `web-push` library — dispatch only, no persistence
 * (the dispatch tail owns pruning and run statuses). VAPID keys stay
 * server-side (§5.2); configuration is lazy so processes that never send
 * (tests, e2e with placeholder keys) don't need a real keypair.
 *
 * Push endpoints are unguessable capability URLs: they are NEVER logged in
 * full — log lines carry a sha256 prefix only (ADR-039).
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private configured = false;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async send(target: PushTarget, payload: string): Promise<PushSendOutcome> {
    this.ensureConfigured();
    try {
      await webPush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        // A reminder older than the catch-up cap should never surface; the
        // push service drops it instead of delivering stale.
        { TTL: 3600 },
      );
      return 'accepted';
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        this.logger.log(
          `Subscription ${this.endpointRef(target.endpoint)} gone (${error.statusCode})`,
        );
        return 'gone';
      }
      const detail =
        error instanceof WebPushError
          ? `status ${error.statusCode}`
          : error instanceof Error
            ? error.message
            : 'unknown error';
      this.logger.warn(`Push send to ${this.endpointRef(target.endpoint)} failed: ${detail}`);
      return 'failed';
    }
  }

  private ensureConfigured(): void {
    if (this.configured) {
      return;
    }
    webPush.setVapidDetails(
      this.configService.get('VAPID_SUBJECT', { infer: true }),
      this.configService.get('VAPID_PUBLIC_KEY', { infer: true }),
      this.configService.get('VAPID_PRIVATE_KEY', { infer: true }),
    );
    this.configured = true;
  }

  /** Loggable endpoint reference — hash prefix, never the capability URL. */
  private endpointRef(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
  }
}
