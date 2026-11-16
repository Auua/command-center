import {
  JournalEntrySchema,
  JournalExportSchema,
  JournalListResponseSchema,
  JournalTodaySchema,
  type CreateJournalEntryRequest,
  type JournalEntry,
  type JournalExport,
  type JournalListResponse,
  type JournalPromptCategory,
  type JournalToday,
  type PatchJournalEntryRequest,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/** Client for /api/v1/journal (JournalModule, ADR-016). */

export async function fetchJournalToday(
  categories: readonly JournalPromptCategory[] = [],
): Promise<JournalToday> {
  const query = categories.length > 0 ? `?categories=${categories.join(',')}` : '';
  const response = await apiFetch(`/api/v1/journal/today${query}`);
  return JournalTodaySchema.parse(await response.json());
}

export interface JournalTimelineQuery {
  from?: string;
  to?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
}

export async function fetchJournalEntries(
  query: JournalTimelineQuery = {},
): Promise<JournalListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await apiFetch(`/api/v1/journal/entries${suffix}`);
  return JournalListResponseSchema.parse(await response.json());
}

export async function fetchJournalEntry(id: string): Promise<JournalEntry> {
  const response = await apiFetch(`/api/v1/journal/entries/${encodeURIComponent(id)}`);
  return JournalEntrySchema.parse(await response.json());
}

export async function createJournalEntry(
  request: CreateJournalEntryRequest,
): Promise<JournalEntry> {
  const response = await apiFetch('/api/v1/journal/entries', { method: 'POST', body: request });
  return JournalEntrySchema.parse(await response.json());
}

export async function patchJournalEntry(
  id: string,
  request: PatchJournalEntryRequest,
): Promise<JournalEntry> {
  const response = await apiFetch(`/api/v1/journal/entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: request,
  });
  return JournalEntrySchema.parse(await response.json());
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await apiFetch(`/api/v1/journal/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchJournalExport(): Promise<JournalExport> {
  const response = await apiFetch('/api/v1/journal/export');
  return JournalExportSchema.parse(await response.json());
}
