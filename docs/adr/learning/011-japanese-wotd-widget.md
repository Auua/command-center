# ADR-011: Japanese Word-of-the-Day widget (incl. "Add to Anki")

- **Status:** proposed
- **Date:** 2026-07-13

## Context

Phase 3 opens the Learning area, and the Japanese Word-of-the-Day (WOTD) widget is its
anchor (dashboard mock: `docs/design/dashboard-mock.html`, "Japanese · Word of the day"
card). The widget shows one word per day — kanji with furigana, romaji, meaning/POS/JLPT
level, an example sentence (JA + EN) — plus a streak pill, a "New word" reroll, and an
"Add to Anki" action with a sync note ("Anki synced 8 min ago").

Forces at play:

- **Anki reachability (ARD §4.5, R2):** AnkiConnect runs inside desktop Anki on
  `localhost:8765`. The cloud API can never reach it; only the user's browser can, and
  only when desktop Anki is open. The ARD mandates a queue-and-flush design, with review
  stats pushed client → API and cached in `anki_snapshots`.
- **Module boundaries (ADR-002, §4.1):** `JapaneseModule` owns `jp_content` and
  `anki_snapshots` (Mongo, §4.3). Streaks live in Postgres and belong to the
  streaks/progress concept under `LearningModule`; domain modules must not import each
  other — cross-domain effects go through the event bus.
- **Content sourcing (R5, §2):** primary dataset is JMdict (CC BY-SA — attribution is a
  license obligation, not a nicety); when external content sources are down we serve
  from the pre-seeded cache.
- **A11y/i18n (NFR-11, NFR-12):** proper furigana rendering, correct language tagging
  (the mock already uses `lang="ja"` on Japanese spans), WCAG 2.1 AA, EN UI copy
  externalized from day one.
- **Widget SDK (§4.2):** must ship as a self-contained `WidgetDefinition` with error and
  suspense isolation; data access only via generated hooks in `packages/contracts`.

## Decision

We will build the WOTD widget as a `japanese-wotd` widget in `apps/web/widgets/`,
backed by `JapaneseModule` endpoints under `/api/v1/japanese/*`, with a client-driven
Anki queue-and-flush protocol as specified below.

### Frontend

- One folder `apps/web/widgets/japanese-wotd/` exporting a `WidgetDefinition` with
  `id: "japanese-wotd"`, supported sizes matching the mock's wide card plus a compact
  variant, `quickActions: [addToAnki, newWord]`, and a zod `settingsSchema`:
  `{ showFurigana: boolean (default true), showRomaji: boolean (default true),
ankiDeckName: string (default "Japanese"), ankiNoteType: string (default "Basic"),
autoFlushQueue: boolean (default true) }`. The auto-generated settings panel renders
  these; no bespoke settings UI.
- Data via TanStack Query hooks generated into `packages/contracts` (ADR-007). The
  widget never touches Supabase or Mongo directly.
- An `ankiConnectClient` lives inside the widget folder (browser-only): probes
  `http://localhost:8765` with a short-timeout `version` call, then uses `addNotes`,
  `findNotes`, and deck/model listing. Reachability is re-probed on mount, on window
  focus, and before every add. AnkiConnect's `webCorsOriginList` must include the app
  origin (§5.2); the setup step is documented in the runbook and linked from the
  widget's settings panel when the probe fails.
- Streak pill: the widget calls the **LearningModule**-owned streaks read endpoint
  (`GET /api/v1/streaks`, ADR-014) through its generated hook and picks out its own
  `japanese-wotd` entry. Frontend composition, not backend composition —
  `JapaneseModule` never imports `LearningModule` (and vice versa).

### Backend

- `JapaneseModule` (NestJS): thin controller, `JapaneseWotdService`,
  `AnkiQueueService`, Mongo repositories built on the `userId`-scoping base class
  (§5.1).
- **Daily selection is computed on read, deterministically** — not precomputed by the
  worker. Selection = stable hash of `(userId, userLocalDate, rerollCount)` — the local
  date taken in the user's profile-stored home IANA timezone (ADR-014 / ARD Q1) — mod the
  eligible `jp_content` pool, then upserted into a `jp_wotd_days` document so the day's
  pick is pinned even if the content pool later changes. Rationale: an on-read pick has
  no missed-tick failure mode (widget works even if the worker is down or the user's
  midnight passed while the worker was asleep), no timezone-edge scheduling, and the
  read is one indexed Mongo fetch — comfortably inside NFR-2. The worker's role is
  reduced to **content-pool refresh**: a low-frequency job ingesting/refreshing
  `jp_content` from external sources. If those sources are down, nothing changes for
  the user — reads always come from `jp_content`, which doubles as the pre-seeded cache
  (§2 failure posture).
- On first fetch of a given day the service emits `wotd.viewed`; a successful
  "Add to Anki" (queued or direct) emits `wotd.studied`. `LearningModule` listens and
  updates the `streaks` row for `japanese-wotd` (once per user-local day, idempotent).
  Reroll does not re-emit `wotd.viewed`.

### Data model

Mongo, all owned by `JapaneseModule`, all documents carrying `userId` where per-user:

- `jp_content` (global, seeded from JMdict + curated examples):
  `{ _id, source: "jmdict", sourceRef, headword, readingKana, romaji,
rubySegments: [{ base, ruby? }], senses: [{ gloss, pos }], jlptLevel,
examples: [{ ja, en, rubySegments }], license: { name: "CC BY-SA 4.0", attribution } }`.
  `rubySegments` is precomputed at ingest so the client never guesses furigana
  alignment.
- `jp_wotd_days`: `{ _id, userId, localDate: "YYYY-MM-DD", contentId, rerollCount,
viewedAt, studiedAt }`, unique index `(userId, localDate)`.
- `anki_queue`: `{ _id, userId, clientRequestId (uuid, unique per (userId,
clientRequestId)), contentId, deckName, modelName, fields, status:
"pending" | "flushed" | "failed", createdAt, flushedAt, ankiNoteId, lastError }`.
- `anki_snapshots` (per §4.3): `{ _id, userId, takenAt, deckName,
counts: { new, learning, due }, reviewsToday }` — written only via client push.

### API contract

All under `/api/v1/japanese`, JWT-guarded, zod-validated (§5.2):

- `GET /wotd` → today's item (content + `rerollCount` + `viewedAt`), plus
  `lastSnapshotAt` and pending-queue count so the card renders sync state in one fetch.
- `POST /wotd/reroll` → re-picks with `rerollCount + 1`, returns new item.
- `POST /anki/queue` `{ clientRequestId, contentId, deckName, modelName, fields }` →
  201 with the queue record; replays of the same `clientRequestId` return the existing
  record (200), never a second one.
- `GET /anki/queue?status=pending` → items awaiting flush.
- `PATCH /anki/queue/:id` `{ status: "flushed", ankiNoteId }` or
  `{ status: "failed", lastError }` — client reports flush outcomes.
- `PUT /anki/snapshot` → client pushes review stats scraped via AnkiConnect
  (`deckNames`/`getDeckStats`); server stamps `takenAt`.

### Anki integration

The defining complexity. Protocol:

1. **Add:** on click, the client probes AnkiConnect. If reachable, it calls `addNotes`
   directly, then `POST /anki/queue` + immediate `PATCH … flushed` so the server holds
   the durable record (one code path, and history survives cache clears). If
   unreachable, only the `POST /anki/queue` happens and the card shows the queued state.
2. **Flush:** whenever the probe succeeds (mount/focus, `autoFlushQueue` on), the client
   pulls `GET /anki/queue?status=pending` and flushes each item.
3. **Idempotency — no duplicate cards:** three layers. (a) `clientRequestId` upsert
   means a retried button click or a flaky POST can't create two queue rows.
   (b) Before `addNotes`, the client runs `findNotes` on a stable first-field key
   (headword + reading) in the target deck; a hit short-circuits to
   `PATCH … flushed` with the found note id. (c) `addNotes` is called with
   `options.duplicateScope: "deck"` so Anki's own dedupe is the final net. A flush
   retry after a crash between `addNotes` and `PATCH` is caught by (b).
4. **Review stats:** after any successful flush (and at most once per hour on focus),
   the client pushes deck stats via `PUT /anki/snapshot`. The card's sync note ("Anki
   synced 8 min ago") is relative time from `lastSnapshotAt` — server-cached, so it
   renders on mobile where AnkiConnect never exists.

### Accessibility

- Every Japanese text node carries `lang="ja"` (word, reading, example) — this selects
  Japanese glyph forms over Chinese variants under Han unification and makes screen
  readers switch to a Japanese voice.
- Furigana rendered as `<ruby lang="ja">約束<rp>(</rp><rt>やくそく</rt><rp>)</rp></ruby>`
  from `rubySegments`; `<rp>` parentheses keep the reading legible in non-ruby renderers
  and clipboard copies. The `showFurigana` setting hides `<rt>` with the visually-hidden
  clip technique, **not** `display: none`/`visibility: hidden` (either would remove the
  reading from the accessibility tree, contradicting the intent that the kana stays in
  accessible output). Note the reading is a supplement, not a crutch: with `lang="ja"` a
  Japanese TTS voice already reads the kanji, and some screen-reader/voice combinations
  announce base + `<rt>` doubled — verify with VoiceOver and NVDA before shipping.
  `showRomaji` toggles the romaji span.
- Sync/queue state is never color-only: "Queued — Anki offline" pairs a clock icon with
  text; "Added to Anki ✓" pairs the check with text (NFR-11 contrast on both).
- The "Add to Anki" button toggles `aria-busy` while working; success and queued outcomes
  are announced via a visually-hidden `aria-live="polite"` region ("Added to Anki",
  "Queued — Anki offline"), while failures ("Failed to add — will retry") use
  `role="alert"`, matching the house pattern (errors alert, successes polite). Reroll
  swaps the card content without moving focus, so the new word is announced through the
  same polite region — otherwise a screen-reader user pressing "New word" hears nothing
  change. All actions keyboard-reachable; reroll and add have visible focus states;
  animations respect `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton mirroring the card layout (word block, meaning line, example,
  footer) to avoid layout shift.
- **Content degraded:** external source outages are invisible (reads always hit
  `jp_content`). If Mongo itself is down, the widget's error boundary shows the standard
  fallback card with retry — the shell survives (§4.2, NFR-4).
- **Anki degraded:** card stays fully functional; footer shows last-synced relative time
  from the snapshot and, when the queue is non-empty, "2 queued" next to it. Button
  states: idle → busy → "Added ✓" (transient) or persistent "Queued" chip.
- **Streak pill** renders from the LearningModule hook; if that call fails, the pill is
  simply omitted — never a broken card.
- **Attribution (R5):** "Dictionary data from JMdict (EDRDG), CC BY-SA" lives in the
  widget's settings/about panel and the app's about page — off the card, but one tap
  away, satisfying the license without cluttering a daily-glance surface.
- **i18n (NFR-12):** all EN UI copy (button labels, sync notes, announcements) lives in
  the message catalog; the sync note's relative time ("8 min ago") is formatted with
  `Intl.RelativeTimeFormat`, not string concatenation. Japanese word/example text is
  _content data_, not UI copy, and is never routed through translation.

## Consequences

- **Easier:** the widget works everywhere — mobile and offline-from-Anki sessions
  degrade to queued adds and cached stats instead of breaking; the on-read selection
  removes a whole class of "worker didn't run" bugs; the frontend-composition rule for
  streaks keeps `JapaneseModule` and `LearningModule` fully decoupled; the event-driven
  streak update is reusable verbatim for grammar-of-the-day and tech-of-the-day widgets.
- **Harder / committed to:** we own a three-layer idempotency protocol and must test it
  (unit-test the flush state machine; e2e with a stubbed AnkiConnect). The first-field
  dedupe key means note types whose first field isn't the word need mapping care.
  Review stats are only as fresh as the last desktop session — accepted per R2.
  `rubySegments` at ingest adds pipeline work but buys correct furigana forever.
- **Security surface:** the browser calling `localhost:8765` is by design (§4.5);
  AnkiConnect CORS is scoped to the app origin, and the API never proxies to it.
- Attribution placement is a license commitment: any future content source added to
  `jp_content` must carry its own `license` block and appear in the about panel.

## Alternatives considered

- **Worker-precomputed daily picks** (nightly job writes `jp_wotd_days` for the next
  day): rejected — adds a scheduler dependency and a tz-edge failure mode (user opens
  the dashboard before the tick lands) for zero user-visible benefit; the worker keeps
  the smaller content-refresh job instead.
- **Server-side Anki sync via an API → AnkiConnect call:** impossible — AnkiConnect is
  desktop-localhost only (§4.5). AnkiWeb scraping rejected on ToS grounds (R2).
- **Composing streaks into the `/wotd` response server-side:** rejected — requires
  `JapaneseModule` → `LearningModule` import or a shared repository, both banned by the
  module rules (§4.1). Frontend composition costs one extra cached request.
- **Local-only Anki queue (IndexedDB, no server record):** rejected — queue would be
  lost on cache clear and invisible cross-device; the API queue is durable, and the ARD
  explicitly places queued adds in the API (§4.5).
- **`kuroshiro`-style client-side furigana generation:** rejected — runtime kanji→kana
  alignment is heavy and error-prone; precomputed `rubySegments` at ingest is
  deterministic and testable.
- **Third-party dictionary API as the live read path:** rejected — availability and
  licensing risk on the hot path (R5); external sources feed the seeded cache offline,
  and reads never leave our Mongo.
