import { z } from 'zod';

/**
 * Learning (ADR-024 as amended by ADR-040): the Obsidian vault in the
 * private learning-center repo is the content model. The API reads the
 * vault-generated `.cc/index` (schemas below mirror `cc_index.py`'s output)
 * and writes progress into note front-matter; the only app-owned file is the
 * day-pin state `.cc/state.json`.
 */

/** JLPT levels, easiest first — the order `jlptCeiling` filters by. */
export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export const JlptLevelSchema = z.enum(JLPT_LEVELS);
export type JlptLevel = z.infer<typeof JlptLevelSchema>;

/** 0 for N5 … 4 for N1; -1 for anything the vault wrote that isn't a level. */
export function jlptRank(level: string | null | undefined): number {
  return level ? (JLPT_LEVELS as readonly string[]).indexOf(level.toUpperCase()) : -1;
}

/** Vault progress vocabulary (`status` front-matter key). */
export const NOTE_STATUSES = ['new', 'learning', 'shaky', 'known'] as const;
export const NoteStatusSchema = z.enum(NOTE_STATUSES);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

/* ------------------------------------------------------------- .cc/index */

const nullableString = z.string().nullable();
const stringList = z.array(z.string());

export const IndexExampleSchema = z.object({
  ja: nullableString,
  fi: nullableString,
  ref: z.string(),
});
export type IndexExample = z.infer<typeof IndexExampleSchema>;

export const IndexSourceSchema = z
  .object({
    book: z.string(),
    chapter: z.number().int().nullable(),
  })
  .nullable();

const IndexRecordBase = z.object({
  /** Vault-relative path — the item's identity (ADR-040). */
  path: z.string().min(1),
  jlpt: nullableString,
  status: nullableString,
  confidence: z.number().int().nullable(),
  reviewed: nullableString,
  created: nullableString,
  sources: stringList,
  source: IndexSourceSchema,
  tags: stringList,
  meaning: z.object({ fi: nullableString, en: nullableString }),
  examples: z.array(IndexExampleSchema),
  cards: z.number().int(),
});

export const VocabRecordSchema = IndexRecordBase.extend({
  type: z.literal('vocab'),
  word: nullableString,
  reading: nullableString,
  romaji: nullableString,
  pos: nullableString,
  kanji: stringList,
  sets: stringList,
}).passthrough();

export const VerbRecordSchema = IndexRecordBase.extend({
  type: z.literal('verb'),
  word: nullableString,
  reading: nullableString,
  romaji: nullableString,
  verbclass: nullableString,
  transitivity: nullableString,
  pair: nullableString,
  kanji: stringList,
  sets: stringList,
}).passthrough();

export const KanjiRecordSchema = IndexRecordBase.extend({
  type: z.literal('kanji'),
  kanji: nullableString,
  strokes: z.number().int().nullable(),
  grade: nullableString,
  onyomi: stringList,
  kunyomi: stringList,
  components: stringList,
  lookalikes: stringList,
}).passthrough();

export const GrammarRecordSchema = IndexRecordBase.extend({
  type: z.literal('grammar'),
  ja: nullableString,
  reading: nullableString,
  func: stringList,
  attaches: stringList,
  formality: nullableString,
  register: stringList,
  similar: stringList,
  compare: nullableString,
}).passthrough();

export const IndexRecordSchema = z.discriminatedUnion('type', [
  VocabRecordSchema,
  VerbRecordSchema,
  KanjiRecordSchema,
  GrammarRecordSchema,
]);
export type IndexRecord = z.infer<typeof IndexRecordSchema>;
export type VocabRecord = z.infer<typeof VocabRecordSchema>;
export type VerbRecord = z.infer<typeof VerbRecordSchema>;
export type KanjiRecord = z.infer<typeof KanjiRecordSchema>;
export type GrammarRecord = z.infer<typeof GrammarRecordSchema>;
export type IndexKind = IndexRecord['type'];

export const INDEX_KINDS = ['vocab', 'verb', 'kanji', 'grammar'] as const;

/** `.cc/index/manifest.json` as `cc_index.py` writes it. */
export const IndexManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string(),
    sha: nullableString,
    counts: z.record(z.number().int()),
    skipped: z.record(z.number().int()),
    shards: z.record(z.array(z.string())),
    errors: z.array(z.string()),
  })
  .passthrough();
export type IndexManifest = z.infer<typeof IndexManifestSchema>;

/* -------------------------------------------------------- .cc/state.json */

export const DayPinSchema = z.object({
  /** UTC learning day the pin was made on. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemId: z.string().min(1),
  /** Acknowledged or skipped — a new pin may be drawn on the next UTC day. */
  resolved: z.boolean(),
  /** Grammar only: whether the pin came from the sequence or the review rotation. */
  mode: z.enum(['new', 'review']).optional(),
});
export type DayPin = z.infer<typeof DayPinSchema>;

/** The one app-owned vault file: `{ schemaVersion, kinds: { wotd, grammar } }`. */
export const LearningStateFileSchema = z.object({
  schemaVersion: z.literal(1),
  kinds: z.record(DayPinSchema),
});
export type LearningStateFile = z.infer<typeof LearningStateFileSchema>;

/* ------------------------------------------------------------- API shapes */

export const LEARNING_STATES = ['ok', 'unavailable', 'token-invalid'] as const;
export const LearningStateSchema = z.enum(LEARNING_STATES);
export type LearningState = z.infer<typeof LearningStateSchema>;

export const MeaningSchema = z.object({
  fi: nullableString,
  en: nullableString,
});

export const WotdExampleSchema = z.object({
  ja: z.string(),
  fi: nullableString,
});

export const WotdItemSchema = z.object({
  /** Vault-relative note path. */
  itemId: z.string().min(1),
  kind: z.enum(['vocab', 'verb']),
  word: z.string(),
  reading: nullableString,
  romaji: nullableString,
  meaning: MeaningSchema,
  jlpt: nullableString,
  pos: nullableString,
  verbclass: nullableString,
  transitivity: nullableString,
  status: nullableString,
  confidence: z.number().int().nullable(),
  examples: z.array(WotdExampleSchema),
  /** github.com link to the note. */
  sourceUrl: z.string().url(),
});
export type WotdItem = z.infer<typeof WotdItemSchema>;

export const IndexInfoSchema = z.object({
  sha: nullableString,
  generatedAt: nullableString,
});

/** GET /learning/wotd?ceiling=N5 and the acknowledge/skip responses. */
export const WotdResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    state: LearningStateSchema,
    /** Serving UTC day. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Null when state ≠ ok or when the eligible set is exhausted. */
    item: WotdItemSchema.nullable(),
    acknowledged: z.boolean(),
    /** True when nothing eligible is left under the ceiling. */
    exhausted: z.boolean(),
    index: IndexInfoSchema,
  }),
]);
export type WotdResponse = z.infer<typeof WotdResponseSchema>;
export type WotdConfiguredResponse = Extract<WotdResponse, { configured: true }>;

export const WotdActionRequestSchema = z
  .object({
    itemId: z.string().min(1).max(512),
  })
  .strict();
export type WotdActionRequest = z.infer<typeof WotdActionRequestSchema>;

/** `?ceiling=` on GET /learning/wotd (the widget's persisted setting). */
export const WotdCeilingSchema = JlptLevelSchema.default('N5');

/** GET /learning/vault-status — the about panel's index line. */
export const VaultStatusResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    state: LearningStateSchema,
    indexedAt: nullableString,
    indexSha: nullableString,
    counts: z.record(z.number().int()),
    skipped: z.record(z.number().int()),
    errors: z.array(z.string()),
    /** github.com URL of the vault repo. */
    repoUrl: z.string().url(),
  }),
]);
export type VaultStatusResponse = z.infer<typeof VaultStatusResponseSchema>;

/* ----------------------------------------------------------- grammar */

export const GrammarItemSchema = z.object({
  /** Vault-relative note path. */
  itemId: z.string().min(1),
  /** The pattern, e.g. `～と`. */
  ja: z.string(),
  reading: nullableString,
  meaning: MeaningSchema,
  jlpt: nullableString,
  func: z.array(z.string()),
  attaches: z.array(z.string()),
  formality: nullableString,
  register: z.array(z.string()),
  similar: z.array(z.string()),
  source: IndexSourceSchema,
  status: nullableString,
  confidence: z.number().int().nullable(),
  examples: z.array(WotdExampleSchema),
  sourceUrl: z.string().url(),
});
export type GrammarItem = z.infer<typeof GrammarItemSchema>;

export const GrammarProgressSchema = z.object({
  /** Points at or below the ceiling with any progress (status ≠ new or reviewed set). */
  seenAtLevel: z.number().int().min(0),
  totalAtLevel: z.number().int().min(0),
});

/** GET /learning/grammar/today?ceiling=N5 and the advance/studied responses. */
export const GrammarResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    state: LearningStateSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    item: GrammarItemSchema.nullable(),
    /** `review` once the sequence under the ceiling is exhausted (ADR-012). */
    mode: z.enum(['new', 'review']),
    studied: z.boolean(),
    progress: GrammarProgressSchema,
    exhausted: z.boolean(),
    index: IndexInfoSchema,
  }),
]);
export type GrammarResponse = z.infer<typeof GrammarResponseSchema>;
export type GrammarConfiguredResponse = Extract<GrammarResponse, { configured: true }>;

/** POST /learning/grammar/advance and /learning/grammar/studied bodies. */
export const GrammarActionRequestSchema = WotdActionRequestSchema;
export type GrammarActionRequest = z.infer<typeof GrammarActionRequestSchema>;
export const GrammarCeilingSchema = JlptLevelSchema.default('N5');

/* ------------------------------------------------------------ anki sync */

/** `sync/state.json`, written only by the vault's anki-sync Action (ADR-026). */
export const SyncStateFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    lastSyncAt: nullableString,
    lastRun: z.object({
      at: z.string(),
      status: z.enum(['ok', 'failed']),
      runId: nullableString,
      url: nullableString,
    }),
    counts: z.record(z.number().int()),
    decks: z.array(
      z
        .object({
          name: z.string(),
          notes: z.number().int(),
          dueToday: z.number().int().optional(),
          new: z.number().int().optional(),
        })
        .passthrough(),
    ),
    errors: z.array(z.string()),
  })
  .passthrough();
export type SyncStateFile = z.infer<typeof SyncStateFileSchema>;

/** GET /learning/anki-status — the footer's three honest states (ADR-026). */
export const AnkiStatusResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    state: LearningStateSchema,
    /** Null until the first successful run has committed its state. */
    lastSyncAt: nullableString,
    lastRunStatus: z.enum(['ok', 'failed', 'never']),
    lastRunUrl: nullableString,
    /** Note commits on the vault since lastSyncAt, excluding the bot's own. */
    pendingCommits: z.number().int().min(0),
    decks: z.array(z.object({ name: z.string(), notes: z.number().int() })),
    errors: z.array(z.string()),
    /** Actions tab of the vault repo (retry lives there). */
    actionsUrl: z.string().url(),
  }),
]);
export type AnkiStatusResponse = z.infer<typeof AnkiStatusResponseSchema>;
export type AnkiStatusConfiguredResponse = Extract<AnkiStatusResponse, { configured: true }>;
