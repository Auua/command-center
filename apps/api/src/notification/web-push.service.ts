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
  private warnedUnconfigured = false;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async send(target: PushTarget, payload: string): Promise<PushSendOutcome> {
    if (!this.ensureConfigured()) {
      return 'failed';
    }
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

  /** False (with one warning) when the optional ADR-039 VAPID keys are unset. */
  private ensureConfigured(): boolean {
    if (this.configured) {
      return true;
    }
    const subject = this.configService.get('VAPID_SUBJECT', { infer: true });
    const publicKey = this.configService.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = this.configService.get('VAPID_PRIVATE_KEY', { infer: true });
    if (!subject || !publicKey || !privateKey) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.warn(
          'Push send skipped: VAPID keys are not configured (ADR-039 env group unset)',
        );
      }
      return false;
    }
    webPush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
    return true;
  }

  /** Loggable endpoint reference — hash prefix, never the capability URL. */
  private endpointRef(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
  }
}
