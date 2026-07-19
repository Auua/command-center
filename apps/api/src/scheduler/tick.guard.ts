import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
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
 */
@Injectable()
export class TickSecretGuard implements CanActivate {
  private readonly expectedDigest: Buffer;

  constructor(configService: ConfigService<Env, true>) {
    this.expectedDigest = digest(configService.get('TICK_SECRET', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
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
