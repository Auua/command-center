import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import type { Env } from '../config/env';

/**
 * Verifies Supabase-issued JWTs (ADR §5.1) against the project's remote JWKS
 * (`/auth/v1/.well-known/jwks.json`) — asymmetric keys, no secret in the API.
 * The `aud` claim must be "authenticated".
 */
@Injectable()
export class JwtVerifierService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(configService: ConfigService<Env, true>) {
    const supabaseUrl = configService.get('SUPABASE_URL', { infer: true }).replace(/\/+$/, '');
    this.jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }

  /**
   * Returns the verified payload or throws (jose errors) on any failure:
   * bad signature, expired, wrong audience, malformed token.
   */
  async verify(token: string): Promise<JWTPayload> {
    const options: JWTVerifyOptions = { audience: 'authenticated' };
    const { payload } = await jwtVerify(token, this.jwks, options);
    return payload;
  }
}
