import {
  MoodCheckinListResponseSchema,
  MoodCheckinSchema,
  type CreateMoodCheckinRequest,
  type MoodCheckin,
  type MoodCheckinListResponse,
} from "@command-center/contracts";
import { apiFetch } from "@/lib/api";

/**
 * Client for /api/v1/mood (MoodModule). The API windows by timestamp only;
 * bucketing into calendar days happens in the widget, in the browser's own
 * timezone. `days` defaults to 8 so a 7-local-day trend is fully covered
 * whatever the UTC offset.
 */

export async function fetchMoodCheckins(
  days = 8,
): Promise<MoodCheckinListResponse> {
  const response = await apiFetch(`/api/v1/mood?days=${days}`);
  return MoodCheckinListResponseSchema.parse(await response.json());
}

export async function createMoodCheckin(
  input: CreateMoodCheckinRequest,
): Promise<MoodCheckin> {
  const response = await apiFetch("/api/v1/mood", {
    method: "POST",
    body: input,
  });
  return MoodCheckinSchema.parse(await response.json());
}

export async function deleteMoodCheckin(id: string): Promise<void> {
  await apiFetch(`/api/v1/mood/${id}`, { method: "DELETE" });
}
