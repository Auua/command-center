import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { NotificationSchema, type Notification } from '@command-center/contracts';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupabaseService } from '../supabase/supabase.service';

const SUBSCRIPTIONS_TABLE = 'push_subscriptions';
const NOTIFICATIONS_TABLE = 'notifications';
const NOTIFICATION_COLUMNS = 'id, title, body, source, automation_id, created_at, read_at';

function toIsoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  // NaN → keep the raw value so schema validation reports the corruption.
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  source: string;
  automation_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface SubscriptionValues {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * User-facing persistence for the bell + push subscriptions (ADR §4.4;
 * ADR-039). RLS-scoped under the caller's JWT — bell rows are *inserted*
 * only by the scheduler's service-role path; this repository reads and
 * marks-read.
 */
@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Idempotent registration: existing (user, endpoint) rows are kept as-is. */
  async upsertSubscriptionForUser(
    user: AuthenticatedUser,
    values: SubscriptionValues,
  ): Promise<void> {
    const client = this.supabaseService.forUser(user.token);
    const { error } = await client.from(SUBSCRIPTIONS_TABLE).upsert(
      {
        user_id: user.id,
        endpoint: values.endpoint,
        p256dh: values.p256dh,
        auth: values.auth,
        user_agent: values.userAgent,
      },
      { onConflict: 'user_id,endpoint', ignoreDuplicates: true },
    );

    if (error) {
      // Never log the endpoint itself (capability URL, ADR-039).
      this.logger.error(`Failed to register push subscription: ${error.message}`);
      throw new InternalServerErrorException('Failed to register push subscription');
    }
  }

  /** Idempotent: deleting an unknown endpoint is a no-op. */
  async deleteSubscriptionForUser(user: AuthenticatedUser, endpoint: string): Promise<void> {
    const client = this.supabaseService.forUser(user.token);
    const { error } = await client
      .from(SUBSCRIPTIONS_TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);

    if (error) {
      this.logger.error(`Failed to remove push subscription: ${error.message}`);
      throw new InternalServerErrorException('Failed to remove push subscription');
    }
  }

  async listForUser(user: AuthenticatedUser, limit: number): Promise<Notification[]> {
    const client = this.supabaseService.forUser(user.token);
    const { data, error } = await client
      .from(NOTIFICATIONS_TABLE)
      .select(NOTIFICATION_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to list notifications: ${error.message}`);
      throw new InternalServerErrorException('Failed to list notifications');
    }
    return ((data ?? []) as NotificationRow[]).map((row) => this.toNotification(row));
  }

  async countUnreadForUser(user: AuthenticatedUser): Promise<number> {
    const client = this.supabaseService.forUser(user.token);
    const { count, error } = await client
      .from(NOTIFICATIONS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);

    if (error) {
      this.logger.error(`Failed to count unread notifications: ${error.message}`);
      throw new InternalServerErrorException('Failed to count unread notifications');
    }
    return count ?? 0;
  }

  /** Marks unread rows read; `ids === 'all'` covers the whole inbox (D5). */
  async markReadForUser(user: AuthenticatedUser, ids: string[] | 'all'): Promise<void> {
    const client = this.supabaseService.forUser(user.token);
    let query = client
      .from(NOTIFICATIONS_TABLE)
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);
    if (ids !== 'all') {
      query = query.in('id', ids);
    }
    const { error } = await query;

    if (error) {
      // A malformed uuid in ids is a validation escapee, but marking nothing
      // read is harmless — still report it as a server fault for visibility.
      this.logger.error(`Failed to mark notifications read: ${error.message}`);
      throw new InternalServerErrorException('Failed to mark notifications read');
    }
  }

  private toNotification(row: NotificationRow): Notification {
    const parsed = NotificationSchema.safeParse({
      id: row.id,
      title: row.title,
      body: row.body,
      source: row.source,
      automationId: row.automation_id,
      createdAt: toIsoOrNull(row.created_at),
      readAt: toIsoOrNull(row.read_at),
    });
    if (!parsed.success) {
      this.logger.error(
        `Stored notification "${row.id}" does not match contract: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Stored notification is invalid');
    }
    return parsed.data;
  }
}
