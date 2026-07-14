# ADR-025: Spaced-repetition review widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

The learning widgets (ADR-011 WOTD, ADR-012 grammar, ADR-013 tech lessons) close only the
_first_ loop: see a new thing once. ADR-024 adds the second half of the capture step — "save
what I learned" writes a durable vault item. What is still missing is the **second learning
loop**: being asked about that item again, later, on a schedule that fights forgetting. This
ADR specifies an in-app, Anki-style review widget: show prompt → reveal → grade
(Again/Hard/Good/Easy) → reschedule.

Forces:

- **ADR-012 said "Anki _is_ the SRS" and rejected in-widget scheduling.** This ADR revises that,
  on reachability rather than taste: AnkiConnect is desktop-only (§4.5, R2), so an Anki-only SRS
  means Anna can only review at her desk with Anki open. A review loop that does not work on a
  phone on a train is a review loop that does not run. The revision is scoped — Anki stays a
  first-class scheduler for items handed to it (ADR-026); it is simply no longer the only one,
  and exactly one scheduler owns any given item (see below).
- **Data split (§4.3):** review state is relational, queryable, and aggregated over time
  (due counts, trends, forecast) → Postgres. Item _content_ lives in Mongo `vault_items`
  (ADR-024). No cross-DB joins; no cross-module imports (§4.1) — composition happens where
  the house style already puts it (ADR-011: frontend composition for the streak pill).
- **Personal scale, no ML infra (G2, NFR-8):** a few thousand cards, one user. Whatever
  scheduler we pick must be a pure function, not a training pipeline.
- NFR-2 (reads < 200 ms), NFR-11 (keyboard + a11y), NFR-12 (i18n) apply as for every widget.

## Decision

We will add a `ReviewModule` (NestJS) owning the Postgres review tables, and a `review` widget
that launches a session on a dedicated route. Review cards are created from ADR-024's
`vault.item_saved` event — saving is the only way a card is born, so the vault stays the single
capture funnel.

### Scheduling algorithm

We will use **FSRS** (Free Spaced Repetition Scheduler) via the `ts-fsrs` library, with **stock
published parameters and no per-user optimization in v1**. FSRS is a pure function
`(cardState, grade, now) → nextState` — no ML infrastructure, no training job, no service
(NFR-8 holds at €0). It beats SM-2 on measured retention at equal workload, it is what modern
Anki schedules with by default, so intervals stay recognizable across the app and Anki
(ADR-026), and its memory state is two floats (`stability`, `difficulty`) that fit a Postgres
row. We keep `review_logs` from day one precisely so that optimizing parameters later is a
data question, not a migration.

Learning steps for new/lapsed cards are FSRS's short-interval states; a card graded `Again`
re-enters the same session's queue (end of queue, not immediately) rather than vanishing until
tomorrow. The scheduler runs **server-side** in `ReviewService` — deterministic, unit-testable,
and impossible to skew by a client clock.

**Review day boundary:** the same **03:00 home-local** boundary ADR-014 uses for streaks, not
midnight and not Anki's 04:00 default. A card due "today" means due at or before the end of the
current review day. This is what makes "I did my reviews today" and "my streak survived today"
agree — two different answers to that question would be a bug users feel.

### Relationship to real Anki (the double-scheduling decision)

**Exactly one scheduler owns an item at a time.** Each review card carries
`srs_owner: 'app' | 'anki'`:

- A saved vault item gets a card with `srs_owner` from the per-deck default setting (`app` for
  both decks initially — see open questions).
- **"Add to Anki" (ADR-026) transfers ownership to Anki**: on `anki.note_created`, `ReviewModule`
  sets `srs_owner = 'anki'` and suspends the app card. It leaves the due queue; the item still
  appears in the vault list, badged "In Anki".
- Anki-owned items are never quizzed in-app, and app-owned items are never pushed as scheduled
  Anki notes. Reviewing the same item in two schedulers is not extra practice — it is two
  contradictory models of one memory, double work, and a permanent "did I already do this
  today?" question. We refuse to build that.
- Transfer is one-way in v1. We cannot read Anki's scheduling state from the cloud (R2); only
  the aggregate snapshots of ADR-026. "Take it back from Anki" would need a schedule import we
  cannot do reliably — flagged below rather than faked.

### Data model

Postgres, owned by `ReviewModule`, RLS per §5.1. `item_id` is the **opaque Mongo vault item
id** — a string, deliberately not a foreign key (no cross-DB references, §4.3):

```sql
review_cards (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users,
  item_id       text NOT NULL,              -- vault_items._id (opaque)
  deck          text NOT NULL,              -- 'japanese' | 'tech'
  srs_owner     text NOT NULL DEFAULT 'app' CHECK (srs_owner IN ('app','anki')),
  state         text NOT NULL DEFAULT 'new',-- new | learning | review | relearning
  due           timestamptz NOT NULL,
  stability     real, difficulty real,      -- FSRS memory state
  reps          int NOT NULL DEFAULT 0,
  lapses        int NOT NULL DEFAULT 0,
  suspended_at  timestamptz,
  last_reviewed_at timestamptz,
  UNIQUE (user_id, item_id)
)
review_logs (                                -- append-only; feeds undo + future FSRS tuning
  id uuid PK, user_id uuid, card_id uuid REFERENCES review_cards,
  grade smallint NOT NULL,                   -- 1 Again .. 4 Easy
  state_before text, stability_before real, difficulty_before real, due_before timestamptz,
  scheduled_days int, reviewed_at timestamptz NOT NULL
)
```

Index `(user_id, srs_owner, suspended_at, due)` serves the due query. `review_logs` grows a row
per review (a few thousand a year — trivial) and buys exact undo and a future optimizer.

### API contract

Under `/api/v1/review`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007):

- `GET /due-count` → `{ dueToday, newToday, nextDueAt }` — one cheap indexed count for the
  dashboard card.
- `POST /sessions` `{ limit? }` → `{ sessionId, cards: [{ cardId, itemId, deck, state }] }` —
  server picks and caps the queue (default 20, from settings); the session is persisted so a
  refresh or a phone-to-laptop hop resumes the same queue instead of reshuffling.
- `POST /cards/:id/grade` `{ sessionId, grade, clientRequestId }` → `{ nextDue, intervalDays,
scheduledDays, remaining }`. Idempotent on `clientRequestId` (ADR-011's pattern): a retried
  or double-fired grade never double-schedules.
- `POST /cards/:id/undo` → restores the pre-grade state from the last `review_logs` row and
  deletes it. Undo, not confirm — the house pattern (ADR-008/009).

**Content is composed on the frontend, not the backend.** The session response carries
`itemId`s; the widget batch-fetches content with ADR-024's `GET /api/v1/vault/items?ids=…` hook
and joins in the client. This is the same call ADR-011 made for the streak pill, and for the
same reason: server-side composition would require `ReviewModule` → `VaultModule` import or a
cross-DB join, both banned (§4.1, §4.3). Cost is one extra cached request per session.

**Events:** each grade emits `review.completed { userId, cardId, itemId, deck, grade }`; the end
of a session emits `review.session_completed { userId, count }`. ADR-014's `EVENT_TO_STREAK` map
gains one entry (`review.completed → 'review'`) — no emitter changes, per that ADR's rule.

### Frontend

- Widget `apps/web/widgets/review/` (`WidgetDefinition`, §4.2). The **card is a launcher, not the
  session**: it shows the due count ("12 due · 3 new"), the next-due time when the queue is
  empty, and a primary "Start review" button.
- The session itself runs on a **dedicated route** (`/review`), not a modal — following ADR-016's
  reasoning verbatim: modals bring focus-trap fragility and no deep links, and a review session is
  a focused, minutes-long task that deserves its own surface (and its own browser back button).
- `settingsSchema` (zod): `{ sessionCap: number (default 20), newPerDay: number (default 5),
gradeButtons: "four" | "two" (default "four"), showNextInterval: boolean (default true) }`.
- `quickActions`: "Start review". No per-card actions on the dashboard card itself.

### Accessibility

- The prompt/answer is a **live region, not a focus move**: revealing swaps the answer into an
  `aria-live="polite"` container so the reveal is announced without yanking focus off the grade
  controls (ADR-011's announcement pattern).
- Keyboard: `Space`/`Enter` reveals; `1`–`4` grade (Again/Hard/Good/Easy); `U` undoes; `Esc` ends
  the session with a summary. Every shortcut has a visible, focusable button behind it — the keys
  are an accelerator, never the only path (NFR-11). Shortcuts are listed in an on-screen "?" help
  popover and in the button `aria-keyshortcuts`.
- Grade buttons are real `<button>`s labelled with word **and** projected interval ("Good — 3
  days"), so the grade is never conveyed by color alone (WCAG 1.4.1) and the consequence of the
  choice is legible before the click. `showNextInterval: false` drops the interval from the label
  but keeps the word.
- Progress is text ("card 4 of 20"), not a bare bar; the bar is `aria-hidden` decoration.
- Card transitions and any flip animation are dropped under `prefers-reduced-motion`; the reveal
  becomes an instant swap.
- Japanese content in a review card carries `lang="ja"` and renders `<ruby>` from ADR-024's stored
  fields, exactly as ADR-011/012 specify — the review surface must not regress furigana handling.

### UX states & interaction

- **Loading:** skeleton of the card frame (prompt block, hidden answer block, four grade buttons).
- **Empty (nothing due):** a genuinely positive state — "Nothing due. Next card in 4 hours." with
  an optional "Review ahead" secondary action (studies the soonest N cards early; FSRS handles
  early reviews natively). Never an error, never a nag.
- **Session complete:** summary ("20 reviewed · 4 again · next session tomorrow"), no confetti and
  no sound — consistent with ADR-014's deliberately quiet celebration posture.
- **Error mid-session:** a failed grade shows an inline `role="alert"` and retries with the same
  `clientRequestId`; the session queue is held client-side, so a blip loses no progress.
- **No streak pressure:** the widget shows no "at risk" styling and sends no notifications
  (ADR-014's position applies unchanged — the streak widget is where streaks live, and it too
  refuses ambient pressure). A due-count badge is information, not a countdown.
- **i18n:** all copy externalized; counts via ICU plurals; intervals formatted with
  `Intl.RelativeTimeFormat`, never string-concatenated (NFR-12).

## Consequences

- **Easier:** the review loop works on any device with a browser — the property Anki structurally
  cannot give us (R2). The vault (ADR-024) gets a second consumer for free: one save action now
  feeds the file, the review card, and (opt-in) the Anki note. Streaks need one map entry.
- **Harder / committed to:** we own an SRS. FSRS state must be migrated carefully if we ever
  change scheduler; `review_logs` is the insurance policy. We also own the `srs_owner` invariant —
  a bug that lets both schedulers hold an item produces exactly the confusion this ADR exists to
  prevent, so it deserves a contract test (an item with an Anki note must never appear in a due
  queue).
- **Committed to** the 03:00-local review day (shared with ADR-014) and to server-side scheduling.
- ADR-012's "Anki is the SRS, no in-widget scheduling" line is **superseded** by this ADR; the
  grammar widget keeps its oldest-seen review rotation for _browsing_, but real scheduling for
  saved items now lives here.
- **Open questions for Anna:** (1) Which deck do you actually want to study where — should
  `japanese` default to `srs_owner: 'anki'` (your existing mobile habit) and `tech` to `'app'`, or
  both to `'app'` until Anki proves better? (2) Session cap of 20 — right size for a dashboard
  card, or too small? (3) Is one-way app→Anki transfer acceptable in v1, or do you need to pull an
  item back? (4) One `review` streak, or one per deck?

## Alternatives considered

- **SM-2 (classic Anki / SuperMemo-2):** rejected — simpler to implement, but measurably worse
  retention per review at the same workload, and its interval math would visibly disagree with the
  FSRS intervals Anki now uses for the same content (ADR-026). We would be hand-writing an
  algorithm that lost.
- **Fixed intervals (1d/3d/7d/21d, Leitner boxes):** rejected — trivially cheap and genuinely
  fine for a hundred cards, but it ignores per-item difficulty entirely and degrades badly as the
  vault grows. FSRS costs one dependency and a two-float column to do better.
- **Per-user FSRS parameter optimization in v1:** rejected as premature — the optimizer needs
  hundreds of reviews to beat the stock parameters, which do not exist yet. `review_logs` keeps
  the option open at zero cost.
- **Anki as the only SRS (status quo of ADR-011/012):** rejected — desktop-only reachability (R2)
  means no reviews on mobile, which is where daily review actually happens.
- **Both schedulers on the same item ("extra practice"):** rejected — two schedulers produce two
  contradictory pictures of the same memory and double the workload; the `srs_owner` invariant
  exists specifically to make this state unrepresentable.
- **SRS state in the vault front-matter (ADR-024's rejected option, restated here):** rejected —
  a git commit per grade, constant reconcile conflicts, and review state is relational by nature
  (due queries, aggregates) — Postgres per §4.3.
- **Session as a modal over the dashboard:** rejected — ADR-016's focus-trap and deep-link
  reasoning applies unchanged; a multi-minute keyboard-driven task needs a real route.
- **Server-composing item content into the session response:** rejected — needs a cross-module
  import or a cross-DB join (§4.1, §4.3). Frontend composition is the established house pattern.
