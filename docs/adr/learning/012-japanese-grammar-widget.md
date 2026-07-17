# ADR-012: Japanese Grammar-point widget

- **Status:** proposed
- **Date:** 2026-07-13 (edited 2026-07-17: the Anki path is re-pointed from the
  superseded AnkiConnect queue-and-flush to ADR-024/026's card-file save + learning-repo
  Action sync)
- **Review:** claude-reviewed — pending product-owner approval

## Context

Phase 3 delivers the learning widgets that are the heart of the product (ARD §8 R5). The Grammar-point
widget shows one Japanese grammar pattern per day — pattern (e.g. 〜てから), a plain-English note, and an
example sentence in JA + EN — as mocked in `docs/design/dashboard-mock.html` (the "Grammar point" card).

Forces:

- ARD §4.3: Japanese content lives in Mongo, owned by `JapaneseModule`; the client never touches Mongo —
  everything goes through the NestJS REST API at `/api/v1` (ADR-004, ADR-007).
- ADR-011 (WOTD widget) and the batch-2 ADRs already decide the shared machinery: on-read
  deterministic daily selection, pinned-ingest content sourcing (ADR-032) with `jp_content` doubling
  as the seeded cache, `rubySegments` precomputed at ingest, event-driven streaks, and the Anki path —
  saving a card file to the learning repo, synced onward by its GitHub Action (ADR-024/026). This ADR
  reuses all of it and decides only what is grammar-specific: the pick _policy_
  (sequenced curriculum vs. hash-random) and the seen/progress model that policy needs.
- Grammar, unlike vocabulary, is cumulative: 〜てから presumes て-form. Random daily picks would routinely
  show patterns whose prerequisites the user hasn't met.
- NFR-11 (a11y), NFR-12 (furigana, externalized UI copy), §2 failure posture (content sources down →
  serve seeded cache), Anki sync via the learning repo's Action (ADR-026), §8 R5 (content licensing —
  attribute sources).
- Module rules (§4.1): domain modules never import each other; streaks live in `LearningModule` +
  Postgres `streaks`, reached via the event bus only.

## Decision

### Frontend

We will implement the widget as `apps/web/widgets/japanese-grammar/`, registered in the widget registry as
a `WidgetDefinition` (ARD §4.2):

- `id: "japanese-grammar"`, `title` from the EN i18n catalog, `sizes: ["3x1", "3x2"]` (matches the mock's
  `span-3` footprint; the taller size shows two examples instead of one).
- `settingsSchema` (zod, drives the auto-generated settings panel), reusing ADR-011's setting names for
  shared concepts: `{ jlptCeiling: enum("N5","N4","N3","N2","N1") = "N5", showFurigana: boolean = true,
showRomaji: boolean = false, revealTranslation: enum("always","tap") = "always" }`. Deck and
  note-type naming belongs to the sync configuration (ADR-026 — grammar cards land in the Japanese
  deck, tagged `cc::grammar`), not to a widget setting.
- `quickActions`: **"Add example to Anki"** and **"Mark studied"**. Anki reuses the ADR-024/026 path
  verbatim: the action saves a card file (`anki: true`, deck `japanese`) via the learning API, and the
  learning repo's Action upserts it into the deck keyed on the deterministic card id. No widget↔Anki
  traffic, no second sync mechanism.
- The widget renders inside the shell-provided error boundary and its own suspense boundary; data comes
  from a generated hook in `packages/contracts` (`useGrammarToday()`), never from Supabase/Mongo directly.

### Backend

We will serve grammar from `JapaneseModule` (it already owns `jp_content`), with:

- **Selection machinery: ADR-011's, unchanged.** Computed on read (no worker tick to miss), then pinned
  in the kind's progress file so refreshes never change today's point. Grammar gets its own file
  (`progress/grammar.json`, ADR-024's per-kind progress mechanism) because the two widgets advance
  independently.
- **Selection policy — the grammar-specific decision: sequenced, not hash-random.** Where WOTD hashes
  `(userId, localDate, rerollCount)` over the pool, grammar picks the lowest-`sequence` **unseen** point
  with `level <= jlptCeiling`. When the ceiling is exhausted, the service switches to review mode:
  the seen point with the oldest `seenAt` (spaced re-exposure; no SRS math in v1 — Anki is the SRS).
- Content ingestion follows ADR-011: the worker's content-refresh job feeds `jp_content` from external
  sources; a seed script guarantees a baseline N5 grammar set at deploy time. Reads always come from
  Mongo, so a content-source outage degrades ingestion, never the widget (ARD §2 failure posture).
- Progress events, not imports (mirroring ADR-011's `wotd.viewed`/`wotd.acknowledged`): first fetch of
  a day emits `grammar.viewed`; **"mark studied" alone** emits `grammar.studied`
  (`{ userId, contentId, date }`) — an Anki save is deck management and never a study/streak signal
  (the 2026-07-17 acknowledge rule; a saved example can be a pattern the user already knows).
  `LearningModule` listens and updates the Postgres `streaks` row for `widget_id = "japanese-grammar"`,
  idempotent per day. `JapaneseModule` never writes `streaks`.

### Data model

We will store grammar as a **document kind inside the existing `jp_content` collection**
(`type: "grammar"` alongside ADR-011's word documents, which gain `type: "word"`), not a separate
collection. Rationale: one owner module, one ingest/seed pipeline, one attribution rule, and the §4.3
one-owner-per-collection rule stays trivially true. A discriminated union in `packages/contracts` keeps
the shapes honest; a compound index `(type, jlptLevel, sequence)` serves the sequenced pick.

```jsonc
// jp_content (type: "grammar") — global, seeded; field shapes match ADR-011
{
  "type": "grammar",
  "slug": "te-kara",
  "jlptLevel": "N5",
  "sequence": 120, // curated teaching order within/across levels
  "pattern": "〜てから", // patterns are kana-heavy; rubySegments used when kanji appear
  "meaningEn": "after doing X",
  "noteEn": "sequences two actions in strict order.",
  "examples": [
    {
      "ja": "宿題をしてから、テレビを見ます。",
      "en": "After doing my homework, I watch TV.",
      "romaji": "shukudai o shite kara, terebi o mimasu.",
      "rubySegments": [
        { "base": "宿題", "ruby": "しゅくだい" },
        { "base": "をしてから、テレビを" },
        { "base": "見", "ruby": "み" },
        { "base": "ます。" },
      ],
    },
  ],
  "license": { "name": "…", "attribution": "…" }, // R5: attribution travels with the doc, per ADR-011
}
```

- `rubySegments` are precomputed at ingest (ADR-011) — `<ruby>` renders from data, no runtime tokenizer,
  and the furigana toggle is a pure render switch.
- Per-user state rides ADR-024's per-kind progress file, `progress/grammar.json` (2026-07-17
  decision: progress for every card kind lives in the learning repo): a `current` day pin
  `{ date, contentId, advanceCount }` plus a `seen` map `{ contentId: { seenAt, studiedAt? } }` —
  the seen-set the sequenced policy and review rotation read. The 2026-07-13 draft's
  `jp_grammar_days`/`jp_grammar_seen` Mongo collections are superseded by it. Streaks/counters
  stay in Postgres via events.

### API contract

REST under `/api/v1/japanese/grammar`, zod-validated, OpenAPI-generated client (ADR-007):

- `GET /api/v1/japanese/grammar/today` →
  `{ item: GrammarPoint, mode: "new" | "review", progress: { seenAtLevel, totalAtLevel }, attribution }`.
  Reads settings (`jlptCeiling`) from the widget's persisted settings via `WidgetRegistryModule` data the
  API already holds; the client does not send the ceiling per-request.
- `POST /api/v1/japanese/grammar/advance` → marks today's point seen and records the next one as today's
  selection ("show another"; increments `advanceCount`); same response shape. Idempotent per point.
- `POST /api/v1/japanese/grammar/:id/studied` → records `studiedAt`, emits `grammar.studied`. 204.
- Anki: the quick action calls ADR-024's `POST /api/v1/learning/cards/grammar` — the shared card
  contract with the kind in the path; the server-side grammar formatter derives the card id from the
  point's `slug` and builds the fields (example JA with furigana, EN, pattern, note) — riding the
  same save→sync lifecycle and status surface (ADR-026). No new contract, no grammar-specific sync
  mechanism.

### Accessibility

- The card is an `<article>` labelled by the visible kicker; the pattern is the card's heading
  (`<h3 class="grammar-pattern">`), with meaning/note and example as distinct grouped blocks — a screen
  reader gets "Grammar point, heading 〜てから, note, example" in order, matching the visual hierarchy.
- All Japanese runs carry `lang="ja"` (pattern, example) so screen readers switch to a Japanese voice
  and Japanese glyph forms win under Han unification; furigana uses real
  `<ruby>…<rp>(</rp><rt>…</rt><rp>)</rp>` markup rendered from `rubySegments`. Per ADR-011, the
  `showFurigana` toggle hides `<rt>` with the visually-hidden clip technique — never
  `display: none`, which would drop the reading from the accessibility tree — so a sighted-user
  preference never degrades screen-reader output; ADR-011's caveat about doubled base+`<rt>`
  reading in some screen-reader/voice combinations applies here too.
- The pattern highlight (mock's coral accent) must meet WCAG 2.1 AA 4.5:1 against the card surface in
  both themes; the accent may color a border/underline instead of the text if the tint can't reach AA.
- No hover-only affordances: "Advance", "Mark studied", and "Add example to Anki" are visible buttons in
  the card footer, keyboard-focusable with visible focus rings. `revealTranslation: "tap"` uses a real
  `<button aria-expanded>` disclosure, not a hover tooltip. Skeleton shimmer respects
  `prefers-reduced-motion`.
- Announcements follow ADR-011's pattern: "Next point" swaps the card without moving focus, so the
  new pattern is announced via the shared polite live region; "Mark studied" and Anki outcomes
  announce there too ("Marked studied", "Example saved — syncs to Anki"), and failures use
  `role="alert"`.

### UX states & interaction

- **Loading:** skeleton mirroring the final layout (pattern line, two note lines, example block) — no
  layout shift on hydrate.
- **Nominal:** pattern, EN note, one example JA+EN, footer actions, small "N5 · 12/80 seen" progress hint.
- **Review mode:** when the ceiling is exhausted, same layout with a "Review" badge — never an empty card.
- **Error:** if `today` fails, the client serves the last-good response from TanStack Query cache with a
  "showing cached point" note; only with no cache at all does the error-boundary fallback card render.
- **"Show another": yes**, as the "advance" action above — it is a deliberate "I know this, next"
  gesture (it marks the current point seen), not a slot machine; copy reads "Next point".
- **i18n:** all UI copy (labels, badges, empty/error strings) lives in the EN message catalog from day
  one (NFR-12); Japanese content is data, never hardcoded strings.

## Consequences

- Grammar rides the shared learning rails (on-read selection, pinned-ingest content, ruby-at-ingest,
  the ADR-024/026 save→sync Anki path, event-driven streaks) — those mechanisms now have two consumers,
  so changes to them must check both ADRs; divergence between the widgets' pipelines is a bug.
- Sequenced progression requires curating a `sequence` order for the grammar dataset before launch —
  more editorial work than a random pick, but it is what makes the widget pedagogically coherent. Its
  progress file also carries more than WOTD's: study state per point (`studiedAt`), not just seen
  dates.
- Streaks-by-event keeps module boundaries clean but means streak credit is eventually consistent with
  the studied action (acceptable: same process, in-memory bus).
- Settings-driven ceiling read server-side means changing JLPT level in settings takes effect on the next
  `today` computation (next day or next advance) — not retroactively for today's already-recorded pick.
- We are committed to per-document license attribution (R5), surfaced in the widget's about/settings
  panel and the app about page, same placement as ADR-011 — any new grammar source must ship its
  `license` block before ingest.

## Alternatives considered

- **Separate `jp_grammar` collection** — rejected: same owner module either way, but two collections mean
  two seed paths, two selection queries, and drift between shapes; a `type` discriminator plus a compound
  index (`type`, `level`, `sequence`) gives the same query performance.
- **Random daily pick (like a word of the day)** — rejected: grammar is prerequisite-ordered; random
  N3 picks for an N5 learner are noise. Sequence + review mode gives a curriculum for free.
- **SRS scheduling inside the widget** — rejected for v1: Anki _is_ the SRS; duplicating scheduling
  logic competes with the "Add to Anki" flow. Oldest-seen review rotation is enough.
- **Client-side furigana tokenization (kuromoji/kuroshiro in the browser)** — rejected: heavy bundles,
  wrong readings without curation, and violates the "widgets are dumb renderers of API data" posture.
- **Tracking "seen" in Postgres under `LearningModule`** — rejected: selection needs the seen-set on the
  hot read path inside `JapaneseModule`; putting it in another module's store forces either a cross-module
  import or a cross-database join, both banned (§4.1, §4.3). Postgres keeps only derived streak counters.
- **A dedicated `/api/v1/japanese/grammar/anki` endpoint** — rejected: ADR-024/026 already define the
  save→sync path and its status surface; a second mechanism would fork sync-state handling.
