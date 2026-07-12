import {
  LayoutResponseSchema,
  type LayoutResponse,
} from "@command-center/contracts";
import { apiFetch } from "@/lib/api";

/**
 * Fetch the user's persisted widget layout from the NestJS API
 * (GET /api/v1/layout). Throws on any failure — the dashboard falls back to
 * the default layout.
 */
export async function fetchLayout(): Promise<LayoutResponse> {
  const response = await apiFetch("/api/v1/layout");
  return LayoutResponseSchema.parse(await response.json());
}
