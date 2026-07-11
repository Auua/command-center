import {
  LayoutResponseSchema,
  type LayoutResponse,
} from "@command-center/contracts";
import { getApiUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

/**
 * Fetch the user's persisted widget layout from the NestJS API
 * (GET /api/v1/layout) with the Supabase access token as Bearer auth.
 * Throws on any failure — the dashboard falls back to the default layout.
 */
export async function fetchLayout(): Promise<LayoutResponse> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("No active session");
  }

  const response = await fetch(`${getApiUrl()}/api/v1/layout`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Layout request failed with status ${response.status}`);
  }

  return LayoutResponseSchema.parse(await response.json());
}
