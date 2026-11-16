import {
  CalendarEventSchema,
  CalendarRangeResponseSchema,
  type CalendarEvent,
  type CalendarEventWrite,
  type CalendarRangeResponse,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Client for /api/v1/calendar (CalendarModule, ADR-018). Reads are
 * expanded occurrences — the client never expands a rule itself.
 */

/** Query key for a range; month → week → month paging hits the cache. */
export const calendarRangeKey = (from: string, to: string): readonly unknown[] => [
  'calendar',
  from,
  to,
];

/** Occurrences in [from, to) — dates in the home timezone, which the response names. */
export async function fetchCalendarRange(from: string, to: string): Promise<CalendarRangeResponse> {
  const response = await apiFetch(`/api/v1/calendar/events?from=${from}&to=${to}`);
  return CalendarRangeResponseSchema.parse(await response.json());
}

export async function fetchCalendarEvent(id: string): Promise<CalendarEvent> {
  const response = await apiFetch(`/api/v1/calendar/events/${encodeURIComponent(id)}`);
  return CalendarEventSchema.parse(await response.json());
}

export async function createCalendarEvent(event: CalendarEventWrite): Promise<CalendarEvent> {
  const response = await apiFetch('/api/v1/calendar/events', { method: 'POST', body: event });
  return CalendarEventSchema.parse(await response.json());
}

/** Replaces the event, or the whole series. */
export async function updateCalendarEvent(
  id: string,
  event: CalendarEventWrite,
): Promise<CalendarEvent> {
  const response = await apiFetch(`/api/v1/calendar/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: event,
  });
  return CalendarEventSchema.parse(await response.json());
}

/** Deletes the event, or the whole series. */
export async function deleteCalendarEvent(id: string): Promise<void> {
  await apiFetch(`/api/v1/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** "Delete this occurrence" — the series skips it. */
export async function deleteCalendarOccurrence(id: string, occurrenceStart: string): Promise<void> {
  await apiFetch(
    `/api/v1/calendar/events/${encodeURIComponent(id)}/occurrences/${encodeURIComponent(occurrenceStart)}`,
    { method: 'DELETE' },
  );
}
