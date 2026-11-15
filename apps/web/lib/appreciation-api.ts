import {
  AppreciationEntrySchema,
  AppreciationListResponseSchema,
  AppreciationPromptTodaySchema,
  type AppreciationEntry,
  type AppreciationListResponse,
  type AppreciationPromptLocale,
  type AppreciationPromptToday,
  type CreateAppreciationRequest,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/** Client for /api/v1/appreciation (AppreciationModule, ADR-017). */

export async function fetchAppreciations(limit: number): Promise<AppreciationListResponse> {
  const response = await apiFetch(`/api/v1/appreciation?limit=${limit}`);
  return AppreciationListResponseSchema.parse(await response.json());
}

export async function createAppreciation(
  request: Pick<CreateAppreciationRequest, 'text'> &
    Partial<Pick<CreateAppreciationRequest, 'tags'>>,
): Promise<AppreciationEntry> {
  const response = await apiFetch('/api/v1/appreciation', { method: 'POST', body: request });
  return AppreciationEntrySchema.parse(await response.json());
}

export async function deleteAppreciation(id: string): Promise<void> {
  await apiFetch(`/api/v1/appreciation/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchAppreciationPrompt(
  locale: AppreciationPromptLocale = 'en',
): Promise<AppreciationPromptToday> {
  const response = await apiFetch(`/api/v1/appreciation/prompts/today?locale=${locale}`);
  return AppreciationPromptTodaySchema.parse(await response.json());
}
