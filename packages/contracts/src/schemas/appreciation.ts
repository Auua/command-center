import { z } from 'zod';

/**
 * Appreciation tracker (ADR-017): one short line per entry, optionally
 * tagged — Postgres `appreciation_entries`, owned by AppreciationModule.
 * Entries are immutable one-liners: edit = delete + re-add, and undo after a
 * delete re-POSTs the same text.
 */
export const APPRECIATION_TEXT_MAX = 280;
export const APPRECIATION_TAGS_MAX = 5;
export const APPRECIATION_TAG_MAX_LENGTH = 24;
/** Largest page `GET /appreciation?limit=` serves. */
export const APPRECIATION_LIST_MAX = 50;

export const AppreciationEntrySchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  tags: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
});
export type AppreciationEntry = z.infer<typeof AppreciationEntrySchema>;

export const AppreciationListResponseSchema = z.object({
  items: z.array(AppreciationEntrySchema),
});
export type AppreciationListResponse = z.infer<typeof AppreciationListResponseSchema>;

const AppreciationTagsSchema = z
  .array(z.string().trim().min(1).max(APPRECIATION_TAG_MAX_LENGTH))
  .max(APPRECIATION_TAGS_MAX)
  .transform((tags) => [...new Set(tags)]);

/**
 * Write path: the same limits the database's check constraints enforce, so
 * a validation failure never reaches Postgres. Unknown top-level fields are
 * rejected (ADR §5.2).
 */
export const CreateAppreciationRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(APPRECIATION_TEXT_MAX),
    tags: AppreciationTagsSchema.default([]),
  })
  .strict();
export type CreateAppreciationRequest = z.infer<typeof CreateAppreciationRequestSchema>;

/** `?limit=` for the recent-entries list; the default is the widget's default `recentCount`. */
export const AppreciationListLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(APPRECIATION_LIST_MAX)
  .default(3);

/** `GET /appreciation/export` — every entry, newest first (NFR-7). */
export const AppreciationExportSchema = z.object({
  exportedAt: z.string().datetime(),
  items: z.array(AppreciationEntrySchema),
});
export type AppreciationExport = z.infer<typeof AppreciationExportSchema>;

/** Locales a prompt may carry; English is always present and is the fallback. */
export const APPRECIATION_PROMPT_LOCALES = ['en', 'fi', 'ja'] as const;
export const AppreciationPromptLocaleSchema = z.enum(APPRECIATION_PROMPT_LOCALES).default('en');
export type AppreciationPromptLocale = z.infer<typeof AppreciationPromptLocaleSchema>;

/**
 * `GET /appreciation/prompts/today` — the day's prompt, the same all day on
 * every device: picked from the active prompts by hash(user id + local
 * date) in the user's home timezone. `date` is that local day, so a client
 * can keep the answer until the day changes.
 */
export const AppreciationPromptTodaySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AppreciationPromptToday = z.infer<typeof AppreciationPromptTodaySchema>;
