import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { TickSecretGuard } from './tick.guard';

const SECRET = 'tick-secret-0123456789abcdef0123456789abcdef';

function contextWithHeaders(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('TickSecretGuard', () => {
  let guard: TickSecretGuard;

  beforeEach(() => {
    const configService = {
      get: () => SECRET,
    } as unknown as ConfigService<Env, true>;
    guard = new TickSecretGuard(configService);
  });

  it('passes with the exact shared secret', () => {
    expect(guard.canActivate(contextWithHeaders({ 'x-tick-secret': SECRET }))).toBe(true);
  });

  it.each([
    ['missing header', {}],
    ['empty header', { 'x-tick-secret': '' }],
    ['wrong secret', { 'x-tick-secret': 'wrong' }],
    ['prefix of the secret', { 'x-tick-secret': SECRET.slice(0, -1) }],
    ['secret plus suffix', { 'x-tick-secret': `${SECRET}x` }],
    ['array header', { 'x-tick-secret': [SECRET] }],
  ])('rejects %s with UnauthorizedException', (_label, headers) => {
    expect(() => guard.canActivate(contextWithHeaders(headers))).toThrow(UnauthorizedException);
  });

  it('never leaks the expected secret in the thrown error', () => {
    try {
      guard.canActivate(contextWithHeaders({ 'x-tick-secret': 'wrong' }));
      fail('expected UnauthorizedException');
    } catch (error) {
      expect(JSON.stringify((error as UnauthorizedException).getResponse())).not.toContain(SECRET);
    }
  });
});
