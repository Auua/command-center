import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { WidgetLayoutItemSchema, type WidgetLayoutItem } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const TABLE = 'widget_layouts';

/**
 * Persistence for widget layouts (ADR §4.2 — layout stored per user in
 * Postgres, JSONB for grid position and settings).
 *
 * Every query runs through an RLS-scoped client built from the caller's own
 * JWT; the explicit `user_id` filters (from the token, never the body) are a
 * second, application-level net (ADR §5.1).
 */
@Injectable()
export class LayoutRepository {
  private readonly logger = new Logger(LayoutRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async findAllForUser(user: AuthenticatedUser): Promise<WidgetLayoutItem[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(TABLE)
      .select('widget_id, grid_pos, settings')
      .eq('user_id', user.id)
      .order('widget_id', { ascending: true });

    if (error) {
      this.logger.error(`Failed to load widget layout: ${error.message}`);
      throw new InternalServerErrorException('Failed to load widget layout');
    }

    return (data ?? []).map((row) => this.toItem(row));
  }

  /** Replaces the user's entire layout: delete-then-insert (idempotent PUT). */
  async replaceForUser(user: AuthenticatedUser, items: WidgetLayoutItem[]): Promise<void> {
    const client = this.supabaseService.forUser(user.token);

    const { error: deleteError } = await client.from(TABLE).delete().eq('user_id', user.id);
    if (deleteError) {
      this.logger.error(`Failed to clear widget layout: ${deleteError.message}`);
      throw new InternalServerErrorException('Failed to save widget layout');
    }

    if (items.length === 0) {
      return;
    }

    const rows = items.map((item) => ({
      user_id: user.id,
      widget_id: item.widgetId,
      grid_pos: item.gridPos,
      settings: item.settings,
    }));

    const { error: insertError } = await client.from(TABLE).insert(rows);
    if (insertError) {
      this.logger.error(`Failed to insert widget layout: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to save widget layout');
    }
  }

  /**
   * Maps a DB row to the contract shape. Parse failures here mean corrupt
   * stored data, so they surface as 500s — never as client-facing ZodErrors
   * (those are reserved for request validation).
   */
  private toItem(row: {
    widget_id: string;
    grid_pos: unknown;
    settings: unknown;
  }): WidgetLayoutItem {
    const parsed = WidgetLayoutItemSchema.safeParse({
      widgetId: row.widget_id,
      gridPos: row.grid_pos,
      settings: row.settings ?? {},
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored layout row for widget "${row.widget_id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored widget layout is invalid');
    }
    return parsed.data;
  }
}
