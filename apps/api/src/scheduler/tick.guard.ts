import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env';

const HEADER = 'x-tick-secret';

/**
 * Guards POST /internal/tick with the shared pinger secret (ADR-039). The
 * comparison is constant-time over sha256 digests (`crypto.timingSafeEqual`
 * needs equal-length buffers; hashing gives that for any input length while
 * keeping the comparison timing-independent of where the strings differ).
 * Mismatch → 401 with no body (see the controller's exception filter);
 * the global throttler rate-caps guessing.
 *
 * With no `TICK_SECRET` configured (the optional Phase 2 env group unset)
 * every tick is rejected the same way — there is nothing to match against —
 * and the reason is logged once so the pinger's 401 alert is explainable.
 */
@Injectable()
export class TickSecretGuard implements CanActivate {
  private readonly logger = new Logger(TickSecretGuard.name);
  private readonly expectedDigest: Buffer | null;
  private warned = false;

  constructor(configService: ConfigService<Env, true>) {
    const secret = configService.get('TICK_SECRET', { infer: true });
    this.expectedDigest = secret ? digest(secret) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.expectedDigest === null) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn('Tick rejected: TICK_SECRET is not configured (ADR-039 env group unset)');
      }
      throw new UnauthorizedException();
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[HEADER];
    const provided = typeof header === 'string' ? header : '';
    if (!timingSafeEqual(this.expectedDigest, digest(provided))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
