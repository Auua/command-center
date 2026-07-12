import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@command-center/contracts';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

/**
 * GET /health — public liveness probe (NFR-10), excluded from the api/v1
 * global prefix in main.ts. The only unauthenticated endpoint (ARD §5.1).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
