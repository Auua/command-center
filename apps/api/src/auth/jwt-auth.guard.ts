import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JWTPayload } from "jose";
import type { AuthenticatedRequest } from "./auth.types";
import { JwtVerifierService } from "./jwt-verifier.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

const BEARER_PREFIX = "Bearer ";

/**
 * Global authentication guard (registered via APP_GUARD in AuthModule).
 * Every route requires a valid Supabase JWT unless marked with @Public().
 * On success the request context carries { id: sub, token: rawJwt }.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtVerifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization || !authorization.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = authorization.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: JWTPayload;
    try {
      payload = await this.jwtVerifier.verify(token);
    } catch (error) {
      this.logger.debug(
        `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException("Invalid or expired token");
    }

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      throw new UnauthorizedException("Token has no subject claim");
    }

    request.user = { id: sub, token };
    return true;
  }
}
