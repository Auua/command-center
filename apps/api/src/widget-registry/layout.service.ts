import { BadRequestException, Injectable } from '@nestjs/common';
import type { LayoutResponse, PutLayoutRequest } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LayoutRepository } from './layout.repository';

/**
 * Business rules for widget layouts (controllers stay thin — ADR §4.1).
 */
@Injectable()
export class LayoutService {
  constructor(private readonly layoutRepository: LayoutRepository) {}

  async getLayout(user: AuthenticatedUser): Promise<LayoutResponse> {
    const items = await this.layoutRepository.findAllForUser(user);
    return { items };
  }

  /** Replaces the user's whole layout; returns the persisted layout. */
  async putLayout(user: AuthenticatedUser, request: PutLayoutRequest): Promise<LayoutResponse> {
    this.assertUniqueWidgetIds(request);
    await this.layoutRepository.replaceForUser(user, request.items);
    return { items: request.items };
  }

  private assertUniqueWidgetIds(request: PutLayoutRequest): void {
    const seen = new Set<string>();
    for (const item of request.items) {
      if (seen.has(item.widgetId)) {
        throw new BadRequestException(`Duplicate widgetId in layout: "${item.widgetId}"`);
      }
      seen.add(item.widgetId);
    }
  }
}
