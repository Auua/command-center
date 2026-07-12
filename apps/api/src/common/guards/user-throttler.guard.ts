import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * Per-user rate limiting (ARD §5.2). The auth guard runs first (AuthModule is
 * imported before this guard is registered), so authenticated requests are
 * tracked by user id; public routes (/health) fall back to the client IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as AuthenticatedUser | undefined;
    if (user?.id) {
      return `user:${user.id}`;
    }
    const ip = typeof req['ip'] === 'string' ? req['ip'] : 'unknown';
    return `ip:${ip}`;
  }
}
