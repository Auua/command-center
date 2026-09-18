import {
  VaultStatusResponseSchema,
  WotdResponseSchema,
  type JlptLevel,
  type VaultStatusResponse,
  type WotdResponse,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Client for /api/v1/learning (LearningModule, ADR-024/040). The JLPT
 * ceiling rides every WOTD call from the widget's own settings — the API
 * never reads another module's persisted settings (ADR-012 rule).
 */

export async function fetchWotd(ceiling: JlptLevel): Promise<WotdResponse> {
  const response = await apiFetch(`/api/v1/learning/wotd?ceiling=${ceiling}`);
  return WotdResponseSchema.parse(await response.json());
}

export async function acknowledgeWotd(itemId: string): Promise<WotdResponse> {
  const response = await apiFetch('/api/v1/learning/wotd/acknowledge', {
    method: 'POST',
    body: { itemId },
  });
  return WotdResponseSchema.parse(await response.json());
}

export async function skipWotd(itemId: string, ceiling: JlptLevel): Promise<WotdResponse> {
  const response = await apiFetch(`/api/v1/learning/wotd/skip?ceiling=${ceiling}`, {
    method: 'POST',
    body: { itemId },
  });
  return WotdResponseSchema.parse(await response.json());
}

export async function fetchVaultStatus(): Promise<VaultStatusResponse> {
  const response = await apiFetch('/api/v1/learning/vault-status');
  return VaultStatusResponseSchema.parse(await response.json());
}
