import {
  AutomationListResponseSchema,
  AutomationRunListResponseSchema,
  AutomationSchema,
  AutomationTemplateListResponseSchema,
  TodayResponseSchema,
  type Automation,
  type AutomationListResponse,
  type AutomationRunListResponse,
  type AutomationTemplateListResponse,
  type CreateAutomationRequest,
  type TodayResponse,
  type UpdateAutomationRequest,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Client for /api/v1/automations (AutomationModule, ADR-015). The today view
 * is expanded server-side in the user's stored timezone — the client never
 * parses cron or evaluates schedules.
 */

export async function fetchToday(): Promise<TodayResponse> {
  const response = await apiFetch('/api/v1/automations/today');
  return TodayResponseSchema.parse(await response.json());
}

export async function fetchAutomations(): Promise<AutomationListResponse> {
  const response = await apiFetch('/api/v1/automations');
  return AutomationListResponseSchema.parse(await response.json());
}

export async function fetchAutomationTemplates(): Promise<AutomationTemplateListResponse> {
  const response = await apiFetch('/api/v1/automations/templates');
  return AutomationTemplateListResponseSchema.parse(await response.json());
}

export async function createAutomation(input: CreateAutomationRequest): Promise<Automation> {
  const response = await apiFetch('/api/v1/automations', {
    method: 'POST',
    body: input,
  });
  return AutomationSchema.parse(await response.json());
}

export async function updateAutomation(
  id: string,
  patch: UpdateAutomationRequest,
): Promise<Automation> {
  const response = await apiFetch(`/api/v1/automations/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  return AutomationSchema.parse(await response.json());
}

export async function deleteAutomation(id: string): Promise<void> {
  await apiFetch(`/api/v1/automations/${id}`, { method: 'DELETE' });
}

export async function fetchAutomationRuns(
  id: string,
  limit = 20,
): Promise<AutomationRunListResponse> {
  const response = await apiFetch(`/api/v1/automations/${id}/runs?limit=${limit}`);
  return AutomationRunListResponseSchema.parse(await response.json());
}
