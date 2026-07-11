import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedRequest, AuthenticatedUser } from "./auth.types";

/**
 * Injects the authenticated user ({ id, token }) resolved by JwtAuthGuard.
 * Throws if used on a route that somehow bypassed the guard — there are no
 * default-user fallbacks (ARD §5.1, single-user posture).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException("No authenticated user in request context");
    }
    return request.user;
  },
);
