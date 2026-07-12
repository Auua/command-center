import { z } from 'zod';

/**
 * Braindump note — quick, unstructured capture (ARD §4.3: document-shaped,
 * lives in MongoDB `braindump_notes`, owned by BraindumpModule). The wire
 * shape is intentionally minimal; the stored document may grow fields over
 * time without breaking this contract.
 */
export const BraindumpNoteSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BraindumpNote = z.infer<typeof BraindumpNoteSchema>;

export const BraindumpListResponseSchema = z.object({
  items: z.array(BraindumpNoteSchema),
});
export type BraindumpListResponse = z.infer<typeof BraindumpListResponseSchema>;

export const CreateBraindumpNoteRequestSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
});
export type CreateBraindumpNoteRequest = z.infer<typeof CreateBraindumpNoteRequestSchema>;

export const UpdateBraindumpNoteRequestSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
});
export type UpdateBraindumpNoteRequest = z.infer<typeof UpdateBraindumpNoteRequestSchema>;
