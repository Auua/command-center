import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';

/**
 * AuthModule (ARD §4.1/§5.1): verifies Supabase JWTs on every request via a
 * global guard and populates the per-request user context. Authorization
 * decisions belong to the API; RLS is the second net underneath.
 */
@Module({
  providers: [
    JwtVerifierService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [JwtVerifierService],
})
export class AuthModule {}
