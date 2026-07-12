import 'reflect-metadata';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtVerifierService } from './jwt-verifier.service';

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- bare stub; the guard only uses it as a Reflector metadata token
    getClass: () => class TestClass {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard({
  isPublic = false,
  payload = null as Record<string, unknown> | null,
}: { isPublic?: boolean; payload?: Record<string, unknown> | null } = {}): {
  guard: JwtAuthGuard;
  verify: jest.Mock;
} {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  const verify = payload
    ? jest.fn().mockResolvedValue(payload)
    : jest.fn().mockRejectedValue(new Error('bad signature'));
  const verifier = { verify } as unknown as JwtVerifierService;
  return { guard: new JwtAuthGuard(reflector, verifier), verify };
}

describe('JwtAuthGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { guard, verify } = makeGuard({ isPublic: true });

    await expect(guard.canActivate(makeContext({ headers: {} } as never))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each<[string | undefined, string]>([
    [undefined, 'missing header'],
    ['Basic abc', 'non-bearer scheme'],
    ['Bearer ', 'empty token'],
    ['Bearer    ', 'whitespace token'],
  ])('rejects %p (%s)', async (authorization) => {
    const { guard } = makeGuard({ payload: { sub: 'user-1' } });
    const context = makeContext({ headers: { authorization } } as never);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens the verifier does not accept', async () => {
    const { guard } = makeGuard({ payload: null });
    const context = makeContext({ headers: { authorization: 'Bearer bad' } } as never);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects verified tokens without a subject claim', async () => {
    const { guard } = makeGuard({ payload: { aud: 'authenticated' } });
    const context = makeContext({ headers: { authorization: 'Bearer x' } } as never);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches { id, token } to the request on success', async () => {
    const { guard, verify } = makeGuard({ payload: { sub: 'user-42' } });
    const request = { headers: { authorization: 'Bearer good-token' } } as AuthenticatedRequest;

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual({ id: 'user-42', token: 'good-token' });
  });
});
