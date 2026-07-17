# ADR-011: Japanese Word-of-the-Day widget (incl. "Add to Anki")

- **Status:** Accepted (2026-07-17)
- **Date:** 2026-07-13 (edited 2026-07-17: the content store and the whole Anki path now
  follow ADR-024/026 — the GitHub learning repo is the store, and its Action syncs to
  AnkiWeb. The original Mongo collections and AnkiConnect queue-and-flush design are
  superseded and survive only in git history; the widget surface, a11y, and streak
  decisions stand. Accepted the same day with carry-over pacing confirmed and
  `showRomaji` flipped to default-off.)
- **Review:** claude-reviewed, PO-reviewed — accepted 2026-07-17

## Context

Phase 3 opens the Learning area, and the Japanese Word-of-the-Day (WOTD) widget is its
anchor (dashboard mock: `docs/design/dashboard-mock.html`, "Japanese · Word of the day"
card). The widget shows one word per day — kanji with furigana, romaji, meaning/POS (plus
a JLPT chip when the pool carries a level), an example sentence (JA + EN; rendered plain —
the dataset aligns furigana for headwords only, ADR-024) — plus a streak pill, an
**acknowledge** action ("learned it" — the only thing that feeds the streak), a **skip**
action ("already knew it" — retires the word and draws a replacement; the mock's "New
word" button, sharpened), and an "Add to Anki" action with a sync note ("Anki synced 8
min ago").

Forces at play:

- **Store & Anki path (ADR-024/026):** the private `learning-center` GitHub repo is the
  store — the seeded word pool (`pool/japanese/`) and saved card files
  (`cards/japanese/…`) live there, read/written by `LearningModule` via the Contents API.
  Saving a card file with `anki: true` front-matter _is_ "Add to Anki": the commit
  triggers the repo's GitHub Action, which runs the official `anki` library against
  AnkiWeb (ADR-026). No desktop in the loop, no browser↔Anki traffic — the widget's only
  Anki surface is rendering sync status.
- **Module boundaries (ADR-002, §4.1):** `LearningModule` owns the repo access and the
  learning endpoints (ADR-024); no Mongo for learning data. Streaks live in Postgres and
  belong to ADR-014's `StreaksService`, whose event handler is the only writer of
  `streaks` rows — cross-domain effects go through the event bus.
- **Content sourcing (R5, ADR-032):** primary dataset is JMdict (CC BY-SA — attribution
  is a license obligation, not a nicety), ingested as pinned release artefacts by
  `tools/jmdict-ingest` and committed to the pool (ADR-024). The API serves its cached
  pool through any GitHub outage, so external sources are never on the read path.
- **A11y/i18n (NFR-11, NFR-12):** proper furigana rendering, correct language tagging
  (the mock already uses `lang="ja"` on Japanese spans), WCAG 2.1 AA, EN UI copy
  externalized from day one.
- **Widget SDK (§4.2):** must ship as a self-contained `WidgetDefinition` with error and
  suspense isolation; data access only via generated hooks in `packages/contracts`.

## Decision

We will build the WOTD widget as a `japanese-wotd` widget in `apps/web/widgets/`, backed
by `LearningModule` endpoints under `/api/v1/learning/*` (ADR-024), with "Add to Anki" as
a card-file save that the learning repo's GitHub Action syncs onward to AnkiWeb (ADR-026).

### Frontend

- One folder `apps/web/widgets/japanese-wotd/` exporting a `WidgetDefinition` with
  `id: "japanese-wotd"`, supported sizes matching the mock's wide card plus a compact
  variant, `quickActions: [acknowledgeWord, addToAnki, skipWord]`, and a zod `settingsSchema`:
  `{ showFurigana: boolean (default true), showRomaji: boolean (default false) }`. The
  auto-generated settings panel renders these; no bespoke settings UI.
  → _PO-review (2026-07-17):_ romaji default flipped to **off** — kana-first reading
  practice; the mock's visible romaji is the opt-in state. Anki deck and
  note-type naming belongs to the sync configuration (ADR-026), not to a widget setting —
  the earlier `ankiDeckName`/`ankiNoteType`/`autoFlushQueue` settings are gone with the
  queue they configured.
- Data via TanStack Query hooks generated into `packages/contracts` (ADR-007). The widget
  never touches Supabase, GitHub, or Anki directly.
- "Add to Anki" calls `POST /api/v1/learning/cards` (ADR-024) through its generated hook.
  The footer renders sync state from `GET /api/v1/learning/anki-status` — ADR-026's three
  honest states (synced / N waiting for sync / failed, with a "view run" link) — plus the
  persistent EDRDG attribution line (ADR-032).
- Streak pill: the widget calls ADR-014's streaks read endpoint (`GET /api/v1/streaks`)
  through its generated hook and picks out its own `japanese-wotd` entry. Frontend
  composition, not backend composition — the WOTD read stays streak-free and the streaks
  endpoint stays widget-agnostic.

### Backend

- Serving follows ADR-024: `LearningModule` holds the pool in API memory (ETag-refreshed,
  SHA-pinned per refresh, served stale indefinitely on GitHub trouble) and picks with a
  date-seeded hash over the **eligible** set — the pool minus what
  `progress/japanese-wotd.json` marks seen or skipped. The learning day is **UTC** (one
  fixed source of truth — no client-supplied date, no timezone guessing). A new word is
  drawn and pinned only on the first serve of a UTC day whose previous word was
  **resolved** — acknowledged or skipped; an untouched word **carries over** (ADR-013's
  unfinished-lesson rule applied to words), so the pace is set by engagement, not the
  calendar. A refresh never changes today's word; no word repeats until the whole pool has
  been seen — then the cycle resets.
  → _PO-review (2026-07-17):_ carry-over pacing confirmed — engagement-paced, not
  calendar-paced; an untouched word waits, even across days.
- **Acknowledge ("learned it"):** `POST /wotd/acknowledge` stamps the current word, moves
  it into `seen`, and flips the card to its learned state — next word tomorrow. This is
  the deliberate "it was new to me and I studied it" gesture, distinct from both skip and
  save.
- **Skip ("already knew it"):** `POST /wotd/skip` adds the current word to `skipped` and
  immediately pins the next eligible pick — a replacement word right away, one commit, no
  streak. Skipped words never return; un-skipping is deleting a line in the progress file.
- Events: reads emit `wotd.viewed` (informational — never a streak source). Acknowledge
  emits `wotd.acknowledged { userId, itemId, date }` (UTC date) — **the only event
  ADR-014's map turns into the `japanese-wotd` streak**; the daily pin already makes more
  than one per UTC day impossible. Saving a card emits no learning event — a saved word
  can be one the user already knows: deck management, not evidence of study
  (product-owner rule, 2026-07-17). Skip emits nothing.

### Data model

No database surface. Per ADR-024 the word pool (pinned JMdict subset, readings already in
Anki bracket furigana, folded at ingest), this widget's per-user progress
(`progress/japanese-wotd.json`: `current` day pin with `acknowledgedAt`, `seen` map,
`skipped` list — written only by the API), and the saved cards are all files in the
learning-center repo, and sync
results live in `sync/state.json` (ADR-026). Streak state stays in Postgres `streaks`
(ADR-014). The 2026-07-13 draft's Mongo collections —
`jp_content`, `jp_wotd_days`, `anki_queue`, `anki_snapshots` — are superseded and will
not exist.

### API contract

ADR-024's, under `/api/v1/learning`, JWT-guarded, zod-validated (§5.2):

- `GET /wotd` → `{ configured: false }` |
  `{ configured: true, date, word, acknowledged, attribution, saved, cardPath? }` —
  `date` is the serving UTC day; `saved` lets the card render "already in your deck"
  without a second call.
- `POST /wotd/acknowledge` `{ itemId }` → the same shape with `acknowledged: true`; 409
  when `itemId` is not the current word, so a stale client never resolves the wrong word
  (midnight race).
- `POST /wotd/skip` `{ itemId }` → the same shape with the replacement word (same 409
  guard; ADR-024's progress mechanics).
- `POST /cards/japanese-wotd` `{ itemId, date? }` → `{ cardId, path, htmlUrl,
alreadyExisted }` — ADR-024's shared card contract with the kind in the path; the
  `japanese-wotd` formatter resolves `itemId` against the pool and writes the card file
  with `anki: true`; the commit is what triggers Anki sync (ADR-026). Idempotent by
  construction: the file path derives from the deterministic card id
  (`jp-<JMdict ent_seq>`), so a retried or repeated save returns `alreadyExisted`, never
  a duplicate.
- `GET /anki-status` →
  `{ configured, lastSyncAt, lastRunStatus, lastRunUrl, pendingCommits, decks }`
  (ADR-026) — one fetch for the footer's sync state.

Gone with the queue: the original draft's `POST/GET/PATCH /api/v1/japanese/anki/queue`
and `PUT /api/v1/japanese/anki/snapshot` never ship (superseded by ADR-026).

### Anki integration

Per ADR-026, nothing Anki-shaped runs in this widget or this API:

1. **Add:** on click, the client calls `POST /cards/japanese-wotd`. Saving the file is
   the entire action. The learning repo's `anki-sync` workflow picks up the commit, upserts a note
   keyed on the card id (searchable `CardId` field + deterministic guid `cc:<card-id>`)
   into the Japanese deck, and syncs with AnkiWeb. Duplicate protection is the idempotent
   save plus ADR-026's three layers — no `clientRequestId`, no probe, no flush.
2. **Status:** the footer's "Anki synced 8 min ago" is relative time from `state.json`'s
   `lastSyncAt`; "2 waiting for sync" counts card commits since then; a failed run shows
   "failed — view run" linking to the Actions tab. All composed server-side by
   `GET /anki-status`, so it is equally true on mobile — where the old design could never
   show an honest green tick.
3. **Latency posture:** the normal save→synced window is a couple of minutes
   (push-triggered run), from any device, desktop off. The card shows "waiting for sync"
   in that window — never a spinner implying live connectivity.

### Accessibility

- Every Japanese text node carries `lang="ja"` (word, reading, example) — this selects
  Japanese glyph forms over Chinese variants under Han unification and makes screen
  readers switch to a Japanese voice.
- Furigana rendered as `<ruby lang="ja">約束<rp>(</rp><rt>やくそく</rt><rp>)</rp></ruby>`
  from the pool's bracket-notation reading (`約束[やくそく]`, ADR-024 — alignment folded
  at ingest, so the client never guesses furigana segmentation); `<rp>` parentheses keep
  the reading legible in non-ruby renderers and clipboard copies. The `showFurigana`
  setting hides `<rt>` with the visually-hidden clip technique, **not**
  `display: none`/`visibility: hidden` (either would remove the reading from the
  accessibility tree, contradicting the intent that the kana stays in accessible output).
  Note the reading is a supplement, not a crutch: with `lang="ja"` a Japanese TTS voice
  already reads the kanji, and some screen-reader/voice combinations announce base +
  `<rt>` doubled — verify with VoiceOver and NVDA before shipping. `showRomaji` toggles
  the romaji span.
- Sync state is never color-only: "Waiting for sync" pairs a clock icon with text;
  "Saved ✓" pairs the check with text (NFR-11 contrast on both).
- The "Add to Anki" button toggles `aria-busy` while working; the success outcome is
  announced via a visually-hidden `aria-live="polite"` region ("Saved — syncs to Anki in
  a few minutes"), while failures ("Save failed — retry") use `role="alert"`, matching
  the house pattern (errors alert, successes polite). Acknowledge announces "Marked
  learned — next word tomorrow" politely; skip swaps the card content without moving
  focus, so the replacement word is announced through the same polite region — otherwise
  a screen-reader user pressing "Skip" hears nothing change. All actions
  keyboard-reachable with visible focus states; animations respect
  `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton mirroring the card layout (word block, meaning line, example,
  footer) to avoid layout shift.
- **Content degraded:** GitHub outages are invisible while the API holds a cached pool —
  a stale word, not a broken widget (ADR-024). A cold boot mid-outage has no pool: the
  card shows "Couldn't load today's word — try again later" with a retry (accepted per
  ADR-024; WOTD is deliberately not crucial). With the env pair unset the API answers
  `configured: false` and the card shows its "not configured" state with a runbook
  pointer; a hard failure falls through to the standard error-boundary fallback card
  (§4.2, NFR-4).
- **Sync state:** the card stays fully functional regardless of sync health; the footer
  shows ADR-026's three states (last-synced relative time; "2 waiting for sync" when card
  commits are newer than `lastSyncAt`; "failed — view run" linking to the Actions tab).
  Button states: idle → busy → "Saved ✓" (transient), after which the save counts under
  "waiting for sync" until `state.json` reports it.
- **Acknowledged:** after acknowledge the card keeps showing the word in a "learned ✓ —
  next word tomorrow" state; skip disappears, "Add to Anki" stays available.
- **Token expired:** ADR-024's explicit token-invalid state renders as its own labelled
  card ("GitHub token expired — see runbook"), distinct from outage staleness — the
  widget is never silently stale on a dead credential.
- **Optional fields:** the JLPT chip renders only when the pool carries a level (the
  curated join is partial — ADR-024/032); example sentences render plain when no furigana
  alignment exists (`lang="ja"` still selects the Japanese TTS voice). Both are normal
  states, never errors.
- **Streak pill** renders from the ADR-014 hook; if that call fails, the pill is simply
  omitted — never a broken card.
- **Attribution (R5, ADR-032):** "Dictionary data © EDRDG (JMdict), CC BY-SA" is a
  persistent one-line card footer. EDRDG's licence requires acknowledgement on each
  screen display, so the about-panel-only placement this ADR first specified is
  superseded by ADR-032; the settings/about panel keeps the full sources list.
- **i18n (NFR-12):** all EN UI copy (button labels, sync notes, announcements) lives in
  the message catalog; the sync note's relative time ("8 min ago") is formatted with
  `Intl.RelativeTimeFormat`, not string concatenation. Japanese word/example text is
  _content data_, not UI copy, and is never routed through translation.

## Consequences

- **Easier:** the widget works everywhere — a save from any device is durable the moment
  the card file lands in the repo, and the footer's sync state is as true on a phone as
  at the desk; on-read selection (date + pool + progress file, no scheduler) removes the
  whole missed-tick/timezone-edge class of bugs, and the progress file means no repeats
  until the pool is exhausted; the widget carries no Anki protocol at all — the sync machinery, its idempotency
  layers, and their tests live with ADR-026; the event-driven streak update is reusable
  verbatim for grammar-of-the-day and tech-of-the-day widgets.
- **Harder / committed to:** freshness is honest but asynchronous — "waiting for sync"
  for a few minutes is the designed steady state, not an error, and a failed sync is
  fixed in the Actions tab, not in the widget. Bracket furigana folded at ingest adds
  pipeline work (ADR-024/032) but keeps every runtime component out of Japanese text
  processing forever.
- **Security surface:** none added — no tokens in the client, no browser↔Anki and no
  browser↔GitHub traffic; the learning-repo PAT is custodied server-side per ADR-024
  (§5.2), and AnkiWeb credentials never leave the learning repo's Actions secrets
  (ADR-026).
- Attribution placement is a license commitment (ADR-032): the footer line renders on
  every word display, and any future content source added to the pool must carry its own
  license/attribution block in the manifest.

## Alternatives considered

- **Worker-precomputed daily picks** (nightly job writes the next day's pick): rejected —
  adds a scheduler dependency and a tz-edge failure mode (user opens the dashboard before
  the tick lands) for zero user-visible benefit; selection is computed on read from
  (date, pool, progress).
- **Zero-state hash selection, no progress file (the interim 2026-07-17 design):**
  rejected — independent daily picks over ~2000 words start repeating within about two
  months (birthday bound) and never cover the pool; the progress file buys no-repeats,
  a true skip, and a pinned day for roughly one commit per day (ADR-024).
- **AnkiConnect — direct or queue-and-flush (this ADR's original design):** superseded by
  ADR-026's learning-repo Action → AnkiWeb sync. Desktop-gated adds, review state stale
  until a desktop session, no honest mobile sync state, and a queue, flush lifecycle, and
  CORS carve-out we owned. ADR-026 carries the full comparison; AnkiWeb _scraping_ stays
  rejected on ToS grounds (the official library speaking the official sync protocol is a
  different act).
- **Streak credit on view or on save:** rejected — a streak earnable by glancing measures
  opening the app, and a save can be a word the user already knows; only the explicit
  acknowledge ("it was new and I studied it") is evidence of learning. One deliberate
  gesture, one streak source.
- **Composing streaks into the `/wotd` response server-side:** rejected — couples the hot
  WOTD read to streak state for the sake of one pill, and forks the house pattern: every
  widget composes its streak client-side from the shared ADR-014 endpoint. Frontend
  composition costs one extra cached request.
- **`kuroshiro`-style client-side furigana generation:** rejected — runtime kanji→kana
  alignment is heavy and error-prone; bracket furigana folded at ingest (ADR-024/032) is
  deterministic and testable.
- **Third-party dictionary API as the live read path:** rejected — availability and
  licensing risk on the hot path (R5, ADR-032); pinned release artefacts feed the pool
  offline, and reads never leave the API's cached copy.
