# ADR-013: Tech "X of the day" micro-lesson widget

- **Status:** accepted
- **Date:** 2026-07-13 (edited 2026-07-17: the Anki path is re-pointed from the
  superseded AnkiConnect queue-and-flush to ADR-024/026's card-file save + learning-repo
  Action sync; amended at acceptance 2026-07-18: lesson content moves from Mongo
  `lesson_content` to authored `pool/tech/` files in the learning repo, and day-pinning
  flips from home timezone to the UTC learning day — both product-owner decisions)
- **Review:** claude-reviewed, PO-reviewed

## Context

Phase 3 delivers the learning widgets. The tech micro-lesson widget shows one short lesson per day
per track (TypeScript, SQL, Java, React): a title, a short explanation, a syntax-highlighted code
snippet, and a takeaway — see the "TypeScript of the day" card in `docs/design/dashboard-mock.html`.
Forces at play:

- The ARD fixes the shape of every widget: SDK conformance (§4.2), data via REST `/api/v1` only,
  lesson content in the learning repo owned by `LearningModule` (ADR-024 as accepted — the repo is
  the store for learning data; the Mongo `lesson_content` collection this ADR first drafted is
  retired unbuilt), streaks in Postgres (§4.3, §4.4)
  with per-kind progress in the learning repo (ADR-024, 2026-07-17 decision), and the Anki path via
  the learning repo's GitHub Action (ADR-024/026).
- The mock hand-rolls highlighting with `<span class="k">` etc. — fine for a static mock, but real
  content must never reach the DOM via `dangerouslySetInnerHTML` (§5.2 spirit), and highlighting
  four language grammars client-side is a bundle-size problem.
- Lessons must feel curated (curriculum, not trivia roulette), feed streaks (§4.4 `streaks` table
  already anticipates `sql-otd`), and stay deterministic — refreshing the page must not change
  today's lesson.
- NFR-11 (a11y), NFR-12 (i18n structure), and R5 (content licensing) apply directly.

## Decision

### Frontend

We will ship **one widget definition, `tech-lesson`, instantiated once per track** via
`settingsSchema` — the user adds "TypeScript of the day" and "SQL of the day" as separate dashboard
instances. The SDK (§4.2) already persists per-instance settings in `widget_layouts.settings`, so a
track selector setting gives us multi-track for free, each instance gets its own grid slot, error
boundary, suspense boundary, and streak — matching how the `streaks` table is keyed. A single
multi-track carousel widget would need bespoke instance state the SDK doesn't model.

- `settingsSchema` (zod): `{ track: 'typescript' | 'sql' | 'java' | 'react', difficulty: 'intro' | 'intermediate' | 'advanced' }` (difficulty defaults to `intro` and selects the curriculum lane).
- `quickActions`: "Add to Anki" (see below); widget footer holds "Mark learned" and copy-to-clipboard on the code block.
- Code rendering: lessons arrive from the API as **pre-tokenized arrays** (see Backend); the widget
  maps tokens to plain React `<span>` elements inside `<pre><code>`. No highlighter in the client
  bundle, no `dangerouslySetInnerHTML` anywhere. Dual-theme colors ship as CSS custom properties per
  token, so theme switching is pure CSS.

### Backend

`LearningModule` owns the feature end to end: content ingest, daily selection, progress, streaks,
events.

- **Highlighting at ingest, not at render.** Lessons are **authored files in the learning repo**
  (`pool/tech/<track>/<seq>-<slug>.md` — see Data model), the same authoring surface as ADR-012's
  grammar points: writing a lesson is a reviewed commit, editable on github.com (ADR-032: authored
  content, `proprietary-own` — no open dataset exists, so there is nothing to ingest from outside).
  A `tools/lesson-ingest` step (sibling of ADR-024's `tools/jmdict-ingest`) validates each lesson
  against the shared zod contract, runs Shiki `codeToTokens` with a light and a dark theme, and
  emits a manifest + token shards that the user commits alongside the sources. Rationale: content
  is written by us and changes rarely; render cost drops to zero (NFR-2), the API stays
  presentation-light but theme-agnostic (tokens carry both colors), and the client never executes
  a highlighter. Ingest fails closed: unknown fields, unsupported languages, a missing `license`
  block (ADR-032), or a palette below AA reject the lesson and the previous shards stand.
- **Daily deterministic selection = sequential curriculum with day-pinning.** Lessons are ordered
  (`seq`) per track+difficulty. Today's lesson is the lowest-`seq` lesson the user has not
  completed, **frozen on first request of the UTC calendar day** (the learning day — the same
  fixed boundary ADR-011/012 use; no client-supplied date; supersedes this ADR's drafted
  home-timezone pinning — _PO-review 2026-07-18: one day rule across all learning kinds_)
  by writing the lane's
  `assignedSeq` + `assignedDate` to `progress/tech.json` (ADR-024's per-kind progress file).
  Repeat fetches return the pinned lesson;
  an unfinished lesson carries over to the next day rather than being skipped. Sequential beats
  shuffled because tracks are curricula (mapped types before `satisfies`); the mock's "Yesterday:
  mapped types" footer falls out of `seq - 1`.
- **Completion emits events.** `POST …/complete` marks the lesson done and advances the lane's
  pointer in the progress file (sha-guarded, idempotent), then emits
  `lesson.completed { userId, track, lessonId }` on the
  in-process event bus — the same pattern `AutomationModule` already consumes for
  `task.completed`, so "smart reminder after finishing a lesson" needs no new plumbing later.
  The `streaks` row (`widget_id = 'tech-lesson:{track}'`) is updated by ADR-014's StreaksService
  event handler (same module, same process), not inline — one event→streak path for every source.
- **"Add to Anki" ships in v1**, reusing the ADR-024/026 path built for the Japanese widget:
  the action saves a card file (`anki: true`, deck `tech`, tags `cc::tech::{track}`) via
  ADR-024's `POST /api/v1/learning/cards/tech` (the shared card contract, kind in the path),
  with the tech formatter mapping `fields` onto ADR-026's `CC Tech v1`
  note type (Question → title, Answer → takeaway, Code → raw source — the sync script
  HTML-escapes and `<pre>`-wraps it at note-build time — Language → track); the learning
  repo's Action upserts it into the Tech deck keyed on the deterministic card id. No new
  infrastructure, high value for a learning widget — deferring it saves almost nothing.
  (ADR-026's two-deck design already specs the Tech mapping; it activates with this
  widget's content track. The ADR-032 sourcing investigation resolved at its acceptance:
  tech content is authored — there is no dataset to wait on.)

### Data model

Learning repo `pool/tech/` (owner: `LearningModule` via ADR-024's read path) — _PO-review
2026-07-18: the Mongo `lesson_content` collection this ADR drafted is retired unbuilt; with
grammar already in the repo (ADR-012), this takes Mongo's learning tenancy to zero._ Two layers,
both committed:

- **Authored source** — `pool/tech/<track>/<seq>-<slug>.md`, YAML front-matter + body:

````markdown
---
track: typescript # typescript | sql | java | react
difficulty: intro # intro | intermediate | advanced — the curriculum lane
seq: 12 # unique (track, difficulty, seq), enforced by the ingest validator
title: Mapped types
tags: [types, generics]
license: { spdx: proprietary-own, source: command-center } # ADR-032: required, typed
---

<intro — short explanation>

```ts
<code — raw source; language from the fence>
```

<takeaway>
````

- **Ingest-emitted shards** — `tools/lesson-ingest` validates the sources (zod contract,
  unknown fields, unsupported languages, duplicate `seq`, missing `license`, sub-AA palette →
  fail closed), runs Shiki `codeToTokens` with the light and dark themes, and emits the lesson
  manifest + per-track JSON shards carrying
  `tokens: [[{ text, cLight, cDark, emphasis? }]]` alongside the raw source (retained for copy
  and re-highlighting). The user runs the tool and commits the output — same workflow, same
  SHA-pinned consistency rules as the word pool (ADR-024).

Per-user progress rides ADR-024's per-kind file, `progress/tech.json` (2026-07-17 decision:
per-kind progress lives in the learning repo), keyed by lane:
`{ "typescript:intro": { nextSeq, assignedSeq, assignedDate, completedCount } }` — superseding
this ADR's original Postgres `lesson_progress` table. Completion updates the lane and emits
`lesson.completed`; the streak stays in Postgres, credited by ADR-014's event handler. The
progress write is sha-guarded and idempotent rather than transactional — acceptable at personal
scale (a lost race re-serves the same lesson; it never corrupts).

### API contract

REST under `/api/v1/learning` (OpenAPI-decorated; typed client generated into
`packages/contracts`):

- `GET /lessons/today?track=&difficulty=` → `{ lesson, progress: { seq, total, streak }, previousTitle, stale: boolean }`. Performs the day-pinning described above, reading lessons from ADR-024's SHA-pinned in-memory repo cache; `stale: true` when GitHub is unreachable and the cache serves the last good content (024's serve-stale posture).
- `POST /lessons/:id/complete` → idempotent (completing an already-completed lesson is a no-op 200); returns updated progress + streak so the client can reconcile.
- Anki: no lesson-specific contract — the quick action saves a card file via ADR-024's `POST /api/v1/learning/cards/tech`, and ADR-026's Action does the rest.

### Accessibility

- Snippet markup is `<pre><code>` (tokens as `<span>`s inside). The `<pre>` is `overflow-x: auto`
  **within the card**, `tabindex="0"`, `role="region"`, `aria-label="Code sample: {lesson title}"` —
  keyboard users can reach and scroll it; the page never scrolls horizontally (NFR-11).
- Token colors are chosen at ingest from two fixed palettes verified ≥ 4.5:1 against the light and
  dark card backgrounds; the ingest script fails on a palette/theme combination below AA.
- Emphasis/diff never relies on color alone: emphasized tokens also get `font-weight`/underline;
  added/removed lines get `+`/`−` gutter characters with `aria-hidden` decoration plus visually
  hidden text.
- Copy-to-clipboard is a real `<button>` with `aria-label="Copy code"`; success flips the label and
  announces "Copied to clipboard" via an `aria-live="polite"` region.
- Skeleton shimmer and the "mark learned" check animation are disabled under
  `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton mirroring the card layout (kicker, title, code block, footer) inside the
  widget's own suspense boundary.
- **Error:** per the §2 failure table, GitHub/API trouble degrades to content, not a dead card —
  the API serves the last-assigned lesson from its repo cache with `stale: true`, and the widget
  shows an unobtrusive "offline copy" note. Only if that also fails does the SDK error boundary
  render the fallback card with retry.
- **Mark learned:** optimistic — button flips to done and the streak pill increments via TanStack
  Query `onMutate`; on failure the state rolls back and an inline `role="alert"` message says so
  (house pattern: a silent rollback is a lie to screen-reader users). Idempotent endpoint makes
  retries safe.
- **Track complete:** when every lesson in the track+difficulty lane is done, the widget shows a
  completion state ("TypeScript · intro — all 60 lessons done") with a pointer to the settings
  panel to switch track or difficulty — never an error card or an empty skeleton. The API signals
  this explicitly (e.g. `lesson: null, progress.completed === total`) rather than 404ing.
- **i18n:** all widget chrome copy ("Mark learned", "Copied to clipboard", stale notice) lives in
  the message catalog (NFR-12). Lesson bodies and code remain English by design — they are content,
  not UI.

## Consequences

- Easier: adding a fifth track is content + one enum value — no new widget code. Streaks,
  automations, and Anki all reuse existing rails, validating the module/event architecture.
- Easier: zero-runtime highlighting keeps NFR-2 comfortable and the client bundle free of grammars.
- Easier: writing a lesson is a reviewed commit, editable on github.com — the same authoring
  surface as grammar (ADR-012), and with this acceptance **Mongo's learning tenancy is zero**:
  every piece of learning data (pool, grammar, lessons, cards, progress, sync state) lives in the
  one repo the user owns.
- Harder: token arrays are denormalized — changing themes/palettes means re-running ingest over all
  lessons (cheap and scripted, but a real step; raw `source` is retained precisely for this).
- Harder: `tools/lesson-ingest` is a second ingest tool to maintain alongside `jmdict-ingest` —
  the cost of moving Shiki out of runtime while keeping the repo the store.
- Harder: curriculum authoring becomes a real content pipeline (ordering, review, licensing notes
  per R5/ADR-032) — accepted, since content quality is the product here.
- Committed to: sequential progression (no random daily surprise), per-track widget instances,
  the UTC learning day shared with ADR-011/012, and the per-lane shape of `progress/tech.json`
  (ADR-024).

## Alternatives considered

- **Keep `lesson_content` in Mongo (the drafted store)** — rejected at acceptance (2026-07-18):
  after ADR-012/024, tech lessons would have been the only learning data left in Mongo — a split
  store for no benefit at single-user scale, and a worse authoring surface than files in the repo.
  The token shards are ingest-emitted artifacts exactly like the word pool's, so the repo handles
  them the same way.
- **One multi-track widget with internal tabs/carousel** — rejected: duplicates instance state the
  SDK already provides, gives one shared error boundary and one grid slot for unrelated tracks, and
  muddies per-track streak keys.
- **Store pre-rendered HTML and inject it** — rejected outright: `dangerouslySetInnerHTML` of
  stored markup is exactly what §5.2 bans for journal content; same reasoning applies here.
- **Client-side highlighting (Shiki/highlight.js in the widget)** — rejected: four grammars +
  highlighter in the dashboard bundle for a card that renders one static snippet; hurts NFR-1.
- **Server-side highlight per request (RSC or API)** — rejected: widgets hydrate client-side via
  TanStack Query (§4.5 dashboard-load flow), so RSC doesn't fit the refetch path, and per-request
  highlighting is repeated work for immutable content.
- **Markdown body as the lesson format** — rejected: a structured `{intro, code, takeaway}` document
  keeps rendering trivial and injection-safe, lets ingest validate each part, and gives "Add to
  Anki" a well-defined front/back without parsing.
- **Date-hash shuffled selection (`hash(user, track, date) % n`)** — rejected: deterministic but
  pedagogically random; breaks prerequisite ordering and the "Yesterday: …" affordance.
- **Defer "Add to Anki" past v1** — rejected: the save→sync path (ADR-024/026) exists independently
  of this widget; reuse cost is one quick action and the `CC Tech v1` field mapping ADR-026 already
  specifies.
