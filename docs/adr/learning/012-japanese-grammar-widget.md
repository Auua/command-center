# ADR-012: Japanese Grammar-point widget

- **Status:** Accepted (2026-07-17)
- **Date:** 2026-07-13 (edited 2026-07-17: the Anki path re-pointed to ADR-024/026's
  card-file save + learning-repo Action sync; accepted the same day with the content store
  moved to the learning repo — authored `pool/grammar/` files, `JapaneseModule` dissolved —
  carry-over pacing on the UTC learning day, and the JLPT ceiling sent per-request. The
  original Mongo `jp_content` design survives in git history.)
- **Review:** claude-reviewed, PO-reviewed — accepted 2026-07-17

## Context

Phase 3 delivers the learning widgets that are the heart of the product (ARD §8 R5). The Grammar-point
widget shows one Japanese grammar pattern per day — pattern (e.g. 〜てから), a plain-English note, and an
example sentence in JA + EN — as mocked in `docs/design/dashboard-mock.html` (the "Grammar point" card).

Forces:

- Learning content lives in the learning-center repo behind `LearningModule` (ADR-024); the client
  never touches GitHub — everything goes through the NestJS REST API at `/api/v1` (ADR-004, ADR-007).
- ADR-011/024/026 already decide the shared machinery: on-read selection over a repo-stored pool
  behind a SHA-pinned, serve-stale cache; per-kind progress files with a UTC learning day and
  carry-over; bracket furigana as the repo-wide convention; event-driven streaks; and the Anki path —
  saving a card file, synced onward by the repo's GitHub Action. This ADR reuses all of it and decides
  only what is grammar-specific: the pick _policy_ (sequenced curriculum vs. hash-random) and the
  seen/progress model that policy needs.
- **Grammar content is authored, not ingested:** no open-licensed JLPT grammar dataset exists
  (ADR-032) — the product owner writes the points. The store must make authoring pleasant.
- Grammar, unlike vocabulary, is cumulative: 〜てから presumes て-form. Random daily picks would routinely
  show patterns whose prerequisites the user hasn't met.
- NFR-11 (a11y), NFR-12 (furigana, externalized UI copy), §2 failure posture (GitHub trouble → serve
  the cached pool), Anki sync via the learning repo's Action (ADR-026), §8 R5 (content licensing —
  authored content is our own; borrowed material must carry its license).
- Module rules (§4.1): streaks stay in Postgres, written only by ADR-014's `StreaksService` event
  handler — grammar emits events and never writes `streaks`, even though it now lives inside
  `LearningModule` itself (the event path is the rule, not module distance).

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
  from a generated hook in `packages/contracts` (`useGrammarToday()`), never from Supabase or GitHub
  directly.

### Backend

We will serve grammar from **`LearningModule`** — the learning repo's owner (ADR-024).
`JapaneseModule` dissolves: WOTD and cards already moved to Learning (ADR-011/024), and grammar was
its last tenant.

- **Selection machinery: ADR-011's, unchanged.** Computed on read (no worker tick to miss), then
  pinned in the kind's progress file (`progress/grammar.json`) on the **UTC learning day**; an
  unresolved point **carries over** — a new point is pinned only after the current one is advanced or
  marked studied.
  → _PO-review (2026-07-17):_ carry-over confirmed — engagement-paced, one rule across all learning
  kinds. Grammar gets its own file because the two widgets advance independently.
- **Selection policy — the grammar-specific decision: sequenced, not hash-random.** Where WOTD hashes
  the UTC date over its eligible pool, grammar picks the lowest-`sequence` **unseen** point with
  `level <= jlptCeiling`. When the ceiling is exhausted, the service switches to review mode:
  the seen point with the oldest `seenAt` (spaced re-exposure; no SRS math — Anki _is_ the SRS,
  reaffirmed by ADR-025's rejection).
- **Content is authored, in the repo:** grammar points are hand-written files under `pool/grammar/`
  in the learning-center repo — one file per point, YAML front-matter as the machine truth (fields
  below), authored as reviewed commits and editable on github.com (ADR-024's whole point, applied to
  authoring). The API serves them through the same SHA-pinned, serve-stale-forever cache as the word
  pool; a malformed file is skipped + reported, never fatal. A baseline N5 set is committed before
  the widget ships — there is no deploy-time seed script and no ingest job.
- Progress events, not imports (mirroring ADR-011's `wotd.viewed`/`wotd.acknowledged`): first fetch of
  a day emits `grammar.viewed`; **"mark studied" alone** emits `grammar.studied`
  (`{ userId, contentId, date }`, UTC date) — an Anki save is deck management and never a study/streak
  signal (the 2026-07-17 acknowledge rule; a saved example can be a pattern the user already knows).
  ADR-014's `StreaksService` updates the Postgres `streaks` row for `widget_id = "japanese-grammar"`,
  idempotent per day — the one event→streak path, same module, same process.

### Data model

Grammar points are **authored files in the learning repo** — `pool/grammar/<slug>.md`, YAML
front-matter as the machine truth plus a generated body for pleasant GitHub reading (ADR-024's card
format, applied to content):

```yaml
# pool/grammar/te-kara.md front-matter
slug: te-kara
jlptLevel: N5 # curated approximation (ADR-032), drives the ceiling filter
sequence: 120 # curated teaching order within/across levels
pattern: 〜てから # patterns are kana-heavy; bracket furigana where kanji appear
meaningEn: after doing X
noteEn: sequences two actions in strict order.
examples:
  - ja: 宿題[しゅくだい]をしてから、テレビを見[み]ます。 # Anki bracket furigana (ADR-024)
    en: After doing my homework, I watch TV.
    romaji: shukudai o shite kara, terebi o mimasu.
license: # only when material is borrowed; authored points are our own (R5)
```

- **Bracket furigana, repo-wide (ADR-024):** the widget renders `<ruby>` from the bracket notation
  exactly as the WOTD widget does — no runtime tokenizer, and the furigana toggle is a pure render
  switch. One convention serves the card, the widget, and Anki's `{{furigana:}}` templates.
- Per-user state rides ADR-024's per-kind progress file, `progress/grammar.json`: a `current` day pin
  `{ date, contentId, advanceCount, studiedAt? }` plus a `seen` map
  `{ contentId: { seenAt, studiedAt? } }` — the seen-set the sequenced policy and review rotation
  read. The 2026-07-13 draft's `jp_grammar_days`/`jp_grammar_seen` Mongo collections are superseded
  by it. Streaks/counters stay in Postgres via events.
- The 2026-07-13 draft's `jp_content` collection is superseded entirely: with words in the repo pool
  and grammar authored in the repo, **`jp_content` exists nowhere**.

### API contract

REST under `/api/v1/learning/grammar`, zod-validated, OpenAPI-generated client (ADR-007):

- `GET /today?ceiling=N5` →
  `{ item: GrammarPoint, mode: "new" | "review", studied, progress: { seenAtLevel, totalAtLevel } }`.
  The ceiling rides the request from the widget's own persisted settings.
  → _PO-review (2026-07-17):_ replaces the drafted server-side read of `WidgetRegistryModule`'s
  persisted settings — the only endpoint in the system that reached into another module's data;
  the client owns delivering its settings, like every other widget.
- `POST /advance` `{ itemId }` → marks the current point seen and pins the next one ("Next point";
  increments `advanceCount`); same response shape. 409 when `itemId` is not the current point
  (ADR-011's stale-client guard).
- `POST /:id/studied` → records `studiedAt`, emits `grammar.studied`. 204. Idempotent.
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
  `<ruby>…<rp>(</rp><rt>…</rt><rp>)</rp>` markup rendered from the bracket notation (ADR-024's
  repo-wide convention). Per ADR-011, the `showFurigana` toggle hides `<rt>` with the visually-hidden
  clip technique — never `display: none`, which would drop the reading from the accessibility tree —
  so a sighted-user preference never degrades screen-reader output; ADR-011's caveat about doubled
  base+`<rt>` reading in some screen-reader/voice combinations applies here too.
- The pattern highlight (mock's coral accent) must meet WCAG 2.1 AA 4.5:1 against the card surface in
  both themes; the accent may color a border/underline instead of the text if the tint can't reach AA.
- No hover-only affordances: "Next point", "Mark studied", and "Add example to Anki" are visible
  buttons in the card footer, keyboard-focusable with visible focus rings. `revealTranslation: "tap"`
  uses a real `<button aria-expanded>` disclosure, not a hover tooltip. Skeleton shimmer respects
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
- **Studied:** after "Mark studied" the point stays up in a "studied ✓" state — next point tomorrow
  (or immediately via "Next point").
- **Error:** if `today` fails, the client serves the last-good response from TanStack Query cache with a
  "showing cached point" note; only with no cache at all does the error-boundary fallback card render.
  The not-configured and token-expired states are ADR-011's, shared via the learning API.
- **"Show another": yes**, as the "advance" action above — it is a deliberate "I know this, next"
  gesture (it marks the current point seen), not a slot machine; copy reads "Next point".
- **i18n:** all UI copy (labels, badges, empty/error strings) lives in the EN message catalog from day
  one (NFR-12); Japanese content is data, never hardcoded strings.

## Consequences

- Grammar rides the shared learning rails (repo store + cache, per-kind progress with UTC carry-over,
  bracket furigana, the ADR-024/026 save→sync Anki path, event-driven streaks) — those mechanisms now
  have two consumers, so changes to them must check both ADRs; divergence between the widgets'
  pipelines is a bug.
- **`JapaneseModule` is gone from the architecture** — `LearningModule` owns every learning kind. The
  module count drops; the §4.1 discipline that matters here is the event-only streak path, which
  stands regardless of module boundaries.
- Sequenced progression requires authoring a `sequence` order before launch — more editorial work than
  a random pick, but it is what makes the widget pedagogically coherent, and authoring-in-repo makes
  reordering a reviewed diff. The progress file carries more than WOTD's: study state per point
  (`studiedAt`), not just seen dates.
- Streaks-by-event means streak credit is eventually consistent with the studied action (acceptable:
  same process, in-memory bus).
- The ceiling rides each request, so changing JLPT level in settings takes effect on the next fetch —
  not retroactively for today's already-pinned point.
- Authored grammar is our own content — no attribution footer needed (unlike JMdict words, ADR-032);
  if a point ever borrows external material, its front-matter carries a `license` block and ADR-032's
  placement rules apply.

## Alternatives considered

- **Mongo `jp_content` documents (this ADR's original store)** — superseded at acceptance: with words
  in the repo pool (ADR-024) and grammar authored by hand, a database collection would have been the
  last Mongo tenant in learning, with a seed script and write path for content a git repo versions,
  reviews, and edits natively. Kept in history as drafted.
- **Random daily pick (like a word of the day)** — rejected: grammar is prerequisite-ordered; random
  N3 picks for an N5 learner are noise. Sequence + review mode gives a curriculum for free.
- **SRS scheduling inside the widget** — rejected: Anki _is_ the SRS (ADR-025 rejected in-app
  scheduling for everything); duplicating scheduling logic competes with the "Add to Anki" flow.
  Oldest-seen review rotation is enough.
- **Client-side furigana tokenization (kuromoji/kuroshiro in the browser)** — rejected: heavy bundles,
  wrong readings without curation, and violates the "widgets are dumb renderers of API data" posture.
- **Tracking "seen" in Postgres** — rejected: per-kind progress lives in the repo (ADR-024); a table
  would split learning state across stores for no gain. Postgres keeps only derived streak counters.
- **Server-side read of the widget's persisted settings for the ceiling** — rejected at acceptance:
  it was the only endpoint reaching into `WidgetRegistryModule`'s data; the client already holds its
  settings and sends the ceiling per request.
- **A dedicated grammar Anki endpoint** — rejected: ADR-024/026 already define the save→sync path and
  its status surface; a second mechanism would fork sync-state handling.
