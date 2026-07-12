import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@command-center/contracts';

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      time: new Date().toISOString(),
    };
  }
}
