# ADR-013: Tech "X of the day" micro-lesson widget

- **Status:** proposed
- **Date:** 2026-07-13
- **Review:** claude-reviewed — pending product-owner approval

## Context

Phase 3 delivers the learning widgets. The tech micro-lesson widget shows one short lesson per day
per track (TypeScript, SQL, Java, React): a title, a short explanation, a syntax-highlighted code
snippet, and a takeaway — see the "TypeScript of the day" card in `docs/design/dashboard-mock.html`.
Forces at play:

- The ARD fixes the shape of every widget: SDK conformance (§4.2), data via REST `/api/v1` only,
  `lesson_content` in MongoDB owned by `LearningModule` (§4.3), streaks and progress counters in
  Postgres (§4.3, §4.4), and the queue-and-flush Anki path (§4.5).
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

- **Highlighting at ingest, not at render.** An ingest script (curated/seeded curriculum files,
  reviewed in-repo per R5 — no scraping) validates each lesson against the shared zod contract,
  then runs Shiki `codeToTokens` with a light and a dark theme and stores the token arrays alongside
  the raw source. Rationale: content is written by us and changes rarely; render cost drops to zero
  (NFR-2), the API stays presentation-light but theme-agnostic (tokens carry both colors), and the
  client never executes a highlighter. Ingest rejects unknown fields and unsupported languages.
- **Daily deterministic selection = sequential curriculum with day-pinning.** Lessons are ordered
  (`seq`) per track+difficulty. Today's lesson is the lowest-`seq` lesson the user has not
  completed, **frozen on first request of the calendar day in the user's profile-stored home
  timezone (ADR-014 / ARD Q1)** by writing
  `assigned_seq` + `assigned_date` to `lesson_progress`. Repeat fetches return the pinned lesson;
  an unfinished lesson carries over to the next day rather than being skipped. Sequential beats
  shuffled because tracks are curricula (mapped types before `satisfies`); the mock's "Yesterday:
  mapped types" footer falls out of `seq - 1`.
- **Completion emits events.** `POST …/complete` marks the lesson done, advances the pointer in
  one Postgres transaction, and emits `lesson.completed { userId, track, lessonId }` on the
  in-process event bus — the same pattern `AutomationModule` already consumes for
  `task.completed`, so "smart reminder after finishing a lesson" needs no new plumbing later.
  The `streaks` row (`widget_id = 'tech-lesson:{track}'`) is updated by ADR-014's StreaksService
  event handler (same module, same process), not inline — one event→streak path for every source.
- **"Add to Anki" ships in v1**, reusing the §4.5 queue-and-flush path built for the Japanese
  widget in the same phase: the action posts to ADR-011's shared queue endpoint
  (`POST /api/v1/japanese/anki/queue`) with a `clientRequestId` and `fields` mapping
  front → title, back → takeaway + code source; the client flushes to AnkiConnect via the shared
  `ankiConnectClient` when reachable, riding the same idempotency and PATCH lifecycle. No new
  infrastructure, high value for a learning widget — deferring it saves almost nothing.

### Data model

MongoDB `lesson_content` (owner: `LearningModule`) — **system content, no `userId`** (a documented
exception to the userId-on-every-document rule of §4.4: this is shared read-only curriculum, served
only through the API; user state lives in Postgres):

```
{
  _id, track, difficulty, seq,            // unique index (track, difficulty, seq)
  title, intro,                            // plain strings (validated, length-capped)
  code: { language, source,                // raw text — for copy & re-highlighting
          tokens: [[{ text, cLight, cDark, emphasis? }]] },
  takeaway, tags: [string],
  source: { attribution?, license? }       // R5: provenance recorded per lesson
}
```

Postgres `lesson_progress` (RLS, user-scoped): `(user_id, track, difficulty, next_seq,
assigned_seq, assigned_date, completed_count)`. Progress counters belong in Postgres per §4.3;
keeping the pointer relational makes completion a single transactional write, with the streak
credited via the `lesson.completed` event (ADR-014).

### API contract

REST under `/api/v1/learning` (OpenAPI-decorated; typed client generated into
`packages/contracts`):

- `GET /lessons/today?track=&difficulty=` → `{ lesson, progress: { seq, total, streak }, previousTitle, stale: boolean }`. Performs the day-pinning described above; `stale: true` when serving fallback content.
- `POST /lessons/:id/complete` → idempotent (completing an already-completed lesson is a no-op 200); returns updated progress + streak so the client can reconcile.
- Anki: reuses the existing shared queue endpoint (`POST /api/v1/japanese/anki/queue`, ADR-011); no lesson-specific route.

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
- **Error:** per the §2 failure table, Mongo/API trouble degrades to content, not a dead card — the
  API serves the last-assigned or seeded lesson with `stale: true`, and the widget shows an
  unobtrusive "offline copy" note. Only if that also fails does the SDK error boundary render the
  fallback card with retry.
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
- Harder: token arrays are denormalized — changing themes/palettes means re-running ingest over all
  lessons (cheap and scripted, but a real step; raw `source` is retained precisely for this).
- Harder: curriculum authoring becomes a real content pipeline (ordering, review, licensing notes
  per R5) — accepted, since content quality is the product here.
- Committed to: sequential progression (no random daily surprise), per-track widget instances, and
  the `lesson_progress` Postgres table shape.

## Alternatives considered

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
- **Defer "Add to Anki" past v1** — rejected: the queue-and-flush path ships in the same phase for
  the Japanese widget; reuse cost is one quick action and a payload mapper.
