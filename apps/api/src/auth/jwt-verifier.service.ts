import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from "jose";
import type { Env } from "../config/env";

/**
 * Verifies Supabase-issued JWTs (ARD §5.1).
 *
 * - If SUPABASE_JWT_SECRET is set: HS256 verification with the shared secret
 *   (legacy Supabase projects).
 * - Otherwise: verification against the project's remote JWKS
 *   (`/auth/v1/.well-known/jwks.json`) — asymmetric keys, no secret in the
 *   API (new Supabase projects).
 *
 * In both cases the `aud` claim must be "authenticated".
 */
@Injectable()
export class JwtVerifierService {
  private readonly hsKey: Uint8Array | null;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(configService: ConfigService<Env, true>) {
    const secret = configService.get("SUPABASE_JWT_SECRET", { infer: true });
    if (secret) {
      this.hsKey = new TextEncoder().encode(secret);
      this.jwks = null;
    } else {
      const supabaseUrl = configService
        .get("SUPABASE_URL", { infer: true })
        .replace(/\/+$/, "");
      this.hsKey = null;
      this.jwks = createRemoteJWKSet(
        new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
      );
    }
  }

  /**
   * Returns the verified payload or throws (jose errors) on any failure:
   * bad signature, expired, wrong audience, malformed token.
   */
  async verify(token: string): Promise<JWTPayload> {
    const options: JWTVerifyOptions = { audience: "authenticated" };
    if (this.hsKey) {
      const { payload } = await jwtVerify(token, this.hsKey, {
        ...options,
        algorithms: ["HS256"],
      });
      return payload;
    }
    // Invariant: exactly one of hsKey/jwks is set by the constructor.
    const { payload } = await jwtVerify(token, this.jwks!, options);
    return payload;
  }
}
