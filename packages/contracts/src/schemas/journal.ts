import { z } from 'zod';
import { APPRECIATION_PROMPT_LOCALES } from './appreciation';

/**
 * Journal (ADR-016): rich-text entries stored as the editor's ProseMirror
 * JSON in Mongo `journal_entries`, owned by JournalModule.
 *
 * The document vocabulary is an **allowlist** — exactly the nodes, marks and
 * attrs the web editor (TipTap 3 StarterKit, configured in
 * `apps/web/components/journal/editor-extensions.ts`) can emit. Anything else
 * — an unknown node, mark, attr or field — is rejected with a 400, never
 * stripped: a validated tree cannot hold anything executable (ADR §5.2).
 */

/** `schemaVersion` stamped on every stored entry — the doc format's version. */
export const JOURNAL_SCHEMA_VERSION = 1;
/** Largest serialized doc the API accepts, in bytes of JSON (ADR-016). */
export const JOURNAL_DOC_MAX_BYTES = 256 * 1024;
/** Deepest node nesting the API accepts (doc = depth 1). */
export const JOURNAL_DOC_MAX_DEPTH = 20;
export const JOURNAL_TAGS_MAX = 10;
export const JOURNAL_TAG_MAX_LENGTH = 32;
/** Characters of plain text kept as an entry's timeline preview. */
export const JOURNAL_PREVIEW_LENGTH = 280;
export const JOURNAL_LIST_MAX = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// ── Document vocabulary ────────────────────────────────────────────────────

export interface JournalLinkAttrs {
  href: string;
  target?: '_blank' | null;
  rel?: string | null;
  class?: null;
  title?: string | null;
}
export type JournalMark =
  { type: 'bold' | 'italic' | 'strike' | 'code' } | { type: 'link'; attrs: JournalLinkAttrs };

export interface JournalTextNode {
  type: 'text';
  text: string;
  marks?: JournalMark[];
}
export interface JournalHardBreakNode {
  type: 'hardBreak';
  marks?: JournalMark[];
}
export type JournalInlineNode = JournalTextNode | JournalHardBreakNode;

export interface JournalParagraphNode {
  type: 'paragraph';
  content?: JournalInlineNode[];
}
export interface JournalHeadingNode {
  type: 'heading';
  attrs: { level: 1 | 2 | 3 };
  content?: JournalInlineNode[];
}
export interface JournalBlockquoteNode {
  type: 'blockquote';
  content: JournalBlockNode[];
}
export interface JournalListItemNode {
  type: 'listItem';
  content: JournalBlockNode[];
}
export interface JournalBulletListNode {
  type: 'bulletList';
  content: JournalListItemNode[];
}
export interface JournalOrderedListNode {
  type: 'orderedList';
  attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null };
  content: JournalListItemNode[];
}
export interface JournalHorizontalRuleNode {
  type: 'horizontalRule';
}
export type JournalBlockNode =
  | JournalParagraphNode
  | JournalHeadingNode
  | JournalBlockquoteNode
  | JournalBulletListNode
  | JournalOrderedListNode
  | JournalHorizontalRuleNode;

export interface JournalDoc {
  type: 'doc';
  content?: JournalBlockNode[];
}

/** `http(s):` only — no `javascript:`, `data:` or relative hrefs. */
const SafeHrefSchema = z
  .string()
  .max(2048)
  // The contracts build has no DOM/Node libs, so no URL(): a scheme check on
  // the raw string, with no whitespace or control characters anywhere.
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  .regex(/^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i, 'Links must be http(s) URLs');

const LinkAttrsSchema: z.ZodType<JournalLinkAttrs> = z
  .object({
    href: SafeHrefSchema,
    target: z.literal('_blank').nullable().optional(),
    rel: z.string().max(100).nullable().optional(),
    class: z.null().optional(),
    title: z.string().max(200).nullable().optional(),
  })
  .strict();

const MarkSchema: z.ZodType<JournalMark> = z.union([
  z.object({ type: z.enum(['bold', 'italic', 'strike', 'code']) }).strict(),
  z.object({ type: z.literal('link'), attrs: LinkAttrsSchema }).strict(),
]);
const MarksSchema = z.array(MarkSchema).max(5).optional();

const InlineSchema: z.ZodType<JournalInlineNode> = z.union([
  z.object({ type: z.literal('text'), text: z.string().min(1), marks: MarksSchema }).strict(),
  z.object({ type: z.literal('hardBreak'), marks: MarksSchema }).strict(),
]);

const BlockSchema: z.ZodType<JournalBlockNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('paragraph'), content: z.array(InlineSchema).optional() }).strict(),
    z
      .object({
        type: z.literal('heading'),
        attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
        content: z.array(InlineSchema).optional(),
      })
      .strict(),
    z.object({ type: z.literal('blockquote'), content: z.array(BlockSchema).min(1) }).strict(),
    z.object({ type: z.literal('bulletList'), content: z.array(ListItemSchema).min(1) }).strict(),
    z
      .object({
        type: z.literal('orderedList'),
        attrs: z
          .object({
            start: z.number().int().min(0).max(1_000_000).optional(),
            type: z.enum(['1', 'a', 'A', 'i', 'I']).nullable().optional(),
          })
          .strict()
          .optional(),
        content: z.array(ListItemSchema).min(1),
      })
      .strict(),
    z.object({ type: z.literal('horizontalRule') }).strict(),
  ]),
);

const ListItemSchema: z.ZodType<JournalListItemNode> = z.lazy(() =>
  z.object({ type: z.literal('listItem'), content: z.array(BlockSchema).min(1) }).strict(),
);

/** UTF-8 byte length without TextEncoder (absent from the contracts' libs). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Nesting depth of a node tree (`doc` alone = 1). */
export function journalDocDepth(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const content = (node as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return 1;
  return 1 + Math.max(...content.map(journalDocDepth));
}

/**
 * The stored rich-text document. Size and depth are checked **before** the
 * recursive parse, so an oversized or pathological tree is refused cheaply.
 */
export const JournalDocSchema: z.ZodType<JournalDoc, z.ZodTypeDef, unknown> = z
  .unknown()
  .superRefine((value, ctx) => {
    const bytes = utf8Length(JSON.stringify(value) ?? '');
    if (bytes > JOURNAL_DOC_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Entry is too large (${bytes} bytes; at most ${JOURNAL_DOC_MAX_BYTES})`,
      });
      return;
    }
    if (journalDocDepth(value) > JOURNAL_DOC_MAX_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Entry is nested too deeply (at most ${JOURNAL_DOC_MAX_DEPTH} levels)`,
      });
    }
  })
  .pipe(z.object({ type: z.literal('doc'), content: z.array(BlockSchema).optional() }).strict());

// ── Entries ────────────────────────────────────────────────────────────────

export const JournalTagsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(JOURNAL_TAG_MAX_LENGTH))
  .max(JOURNAL_TAGS_MAX)
  .transform((tags) => [...new Set(tags)]);

/** Timeline row: everything but the doc. */
export const JournalEntrySummarySchema = z.object({
  id: z.string().min(1),
  entryDate: isoDate,
  textPreview: z.string(),
  wordCount: z.number().int().min(0),
  tags: z.array(z.string()),
  promptId: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type JournalEntrySummary = z.infer<typeof JournalEntrySummarySchema>;

export const JournalEntrySchema = JournalEntrySummarySchema.extend({
  doc: JournalDocSchema,
  schemaVersion: z.number().int().min(1),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/**
 * `POST /journal/entries` — the first save of an entry. `entryDate` defaults
 * to today in the user's home timezone. Derived fields (`plainText`,
 * `textPreview`, `wordCount`) are never accepted from a client.
 */
export const CreateJournalEntryRequestSchema = z
  .object({
    entryDate: isoDate.optional(),
    doc: JournalDocSchema,
    tags: JournalTagsSchema.default([]),
    promptId: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type CreateJournalEntryRequest = z.input<typeof CreateJournalEntryRequestSchema>;

/**
 * `PATCH /journal/entries/:id` — autosave. `baseVersion` is the version the
 * client edited; a mismatch is a 409 and nothing is written.
 */
export const PatchJournalEntryRequestSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    doc: JournalDocSchema.optional(),
    tags: JournalTagsSchema.optional(),
  })
  .strict()
  .refine((body) => body.doc !== undefined || body.tags !== undefined, {
    message: 'Nothing to save: send doc and/or tags',
  });
export type PatchJournalEntryRequest = z.input<typeof PatchJournalEntryRequestSchema>;

/** `GET /journal/entries?from&to&tag&cursor&limit` — newest entryDate first. */
export const JournalListQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    tag: z.string().trim().toLowerCase().min(1).max(JOURNAL_TAG_MAX_LENGTH).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(JOURNAL_LIST_MAX).default(20),
  })
  .strict();
export type JournalListQuery = z.infer<typeof JournalListQuerySchema>;

export const JournalListResponseSchema = z.object({
  items: z.array(JournalEntrySummarySchema),
  /** Opaque; pass back as `cursor` for the next (older) page. Null at the end. */
  nextCursor: z.string().nullable(),
});
export type JournalListResponse = z.infer<typeof JournalListResponseSchema>;

// ── Search (4C-2) ──────────────────────────────────────────────────────────

export const JOURNAL_SEARCH_QUERY_MAX = 200;

/**
 * `GET /journal/search?q&from&to&tag&cursor&limit` — Atlas Search over the
 * server-derived `plainText` and the tags. Every word must match; results
 * are newest first and page with the timeline's cursor. A 503 means search
 * is not available (the index is missing or still building).
 */
export const JournalSearchQuerySchema = JournalListQuerySchema.extend({
  q: z.string().trim().min(1).max(JOURNAL_SEARCH_QUERY_MAX),
}).strict();
export type JournalSearchQuery = z.infer<typeof JournalSearchQuerySchema>;

/** One run of a highlighted passage; `hit` runs are the matched words. */
export const JournalSearchFragmentSchema = z.object({ text: z.string(), hit: z.boolean() });
export type JournalSearchFragment = z.infer<typeof JournalSearchFragmentSchema>;

/** A timeline row plus the passages of `plainText` that matched, best first. */
export const JournalSearchHitSchema = JournalEntrySummarySchema.extend({
  highlights: z.array(z.array(JournalSearchFragmentSchema)),
});
export type JournalSearchHit = z.infer<typeof JournalSearchHitSchema>;

export const JournalSearchResponseSchema = z.object({
  items: z.array(JournalSearchHitSchema),
  nextCursor: z.string().nullable(),
});
export type JournalSearchResponse = z.infer<typeof JournalSearchResponseSchema>;

// ── Prompts and the launcher ───────────────────────────────────────────────

export const JOURNAL_PROMPT_CATEGORIES = ['reflect', 'gratitude', 'growth', 'feelings'] as const;
export const JournalPromptCategorySchema = z.enum(JOURNAL_PROMPT_CATEGORIES);
export type JournalPromptCategory = z.infer<typeof JournalPromptCategorySchema>;

export const JournalPromptLocaleSchema = z.enum(APPRECIATION_PROMPT_LOCALES).default('en');

/**
 * `?categories=reflect,growth` — empty or absent means every category.
 * Unknown names are a 400, so a typo never silently empties the pool.
 */
export const JournalPromptCategoriesQuerySchema = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(JournalPromptCategorySchema));

/**
 * `GET /journal/today` — everything the launcher card needs in one read:
 * the home-timezone date, the day's prompt (same all day, every device —
 * hash(userId|date) over the active prompts in the chosen categories, null
 * when none) and the latest entry written for that date.
 */
export const JournalTodaySchema = z.object({
  date: isoDate,
  prompt: z.object({ id: z.string().min(1), text: z.string().min(1) }).nullable(),
  entry: JournalEntrySummarySchema.nullable(),
  entriesToday: z.number().int().min(0),
});
export type JournalToday = z.infer<typeof JournalTodaySchema>;

/** `GET /journal/export` — every entry, raw doc **and** Markdown (NFR-7). */
export const JournalExportSchema = z.object({
  exportedAt: z.string().datetime(),
  schemaVersion: z.number().int(),
  items: z.array(JournalEntrySchema.extend({ markdown: z.string() })),
});
export type JournalExport = z.infer<typeof JournalExportSchema>;
