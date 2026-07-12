import {
  BraindumpListResponseSchema,
  BraindumpNoteSchema,
  type BraindumpListResponse,
  type BraindumpNote,
} from "@command-center/contracts";
import { apiFetch } from "@/lib/api";

/** Client for /api/v1/braindump (BraindumpModule). */

export async function fetchBraindumpNotes(): Promise<BraindumpListResponse> {
  const response = await apiFetch("/api/v1/braindump");
  return BraindumpListResponseSchema.parse(await response.json());
}

export async function createBraindumpNote(
  content: string,
): Promise<BraindumpNote> {
  const response = await apiFetch("/api/v1/braindump", {
    method: "POST",
    body: { content },
  });
  return BraindumpNoteSchema.parse(await response.json());
}

export async function updateBraindumpNote(
  id: string,
  content: string,
): Promise<BraindumpNote> {
  const response = await apiFetch(`/api/v1/braindump/${id}`, {
    method: "PATCH",
    body: { content },
  });
  return BraindumpNoteSchema.parse(await response.json());
}

export async function deleteBraindumpNote(id: string): Promise<void> {
  await apiFetch(`/api/v1/braindump/${id}`, { method: "DELETE" });
}
