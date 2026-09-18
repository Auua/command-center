import { Controller, Get } from '@nestjs/common';
import type { StreaksResponse } from '@command-center/contracts';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { StreaksService } from './streaks.service';

/** GET /api/v1/streaks — one read, one round trip (ADR-014). No writes. */
@Controller('streaks')
export class StreaksController {
  constructor(private readonly streaksService: StreaksService) {}

  @Get()
  getStreaks(@CurrentUser() user: AuthenticatedUser): Promise<StreaksResponse> {
    return this.streaksService.getStreaks(user);
  }
}
