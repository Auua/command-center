import {
  LayoutResponseSchema,
  type LayoutResponse,
  type WidgetLayoutItem,
} from '@command-center/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Fetch the user's persisted widget layout from the NestJS API
 * (GET /api/v1/layout). Throws on any failure — the dashboard falls back to
 * the default layout.
 */
export async function fetchLayout(): Promise<LayoutResponse> {
  const response = await apiFetch('/api/v1/layout');
  return LayoutResponseSchema.parse(await response.json());
}

/**
 * Replace the whole layout (PUT /api/v1/layout). The settings panel is the
 * first caller: it writes back the full item list with one item's settings
 * changed, so a user whose layout was still the client default gets it
 * persisted on the first save.
 */
export async function putLayout(items: WidgetLayoutItem[]): Promise<LayoutResponse> {
  const response = await apiFetch('/api/v1/layout', {
    method: 'PUT',
    body: { items },
  });
  return LayoutResponseSchema.parse(await response.json());
}
