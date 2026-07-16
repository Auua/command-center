# ADR-014: Streaks widget

- **Status:** proposed
- **Date:** 2026-07-13
- **Review:** claude-reviewed — pending product-owner approval

## Context

Phase 3 introduces streaks (ARD §9): consecutive-day counters for habits like Japanese study,
journaling, or the daily TypeScript lesson. The dashboard mock (`docs/design/dashboard-mock.html`)
shows a card with rows of {day count, streak name, last-7-days dots} and a "Best: Japanese, 31 days"
footer.

Forces:

- §4.4 defines a Postgres `streaks` table (`widget_id`, `current_len`, `best_len`,
  `last_active_date`) owned by `LearningModule` (§4.1). But streak-worthy activity happens in
  _other_ modules (task done, mood logged, journal written, WOTD studied), and module rules forbid
  direct imports — cross-domain reactions must ride the event bus.
- §4.5 lists "streak rollover" as a worker job: something must mark a streak broken when a day
  passes with no activity, even if the app is never opened. §8 Q1 flags timezone/DST/travel as an
  open question — "did I keep the streak today?" depends on where "today" ends.
- This is a wellbeing-adjacent personal app: streak mechanics motivate, but streak _anxiety_ is a
  known dark pattern. The UX must take a position.
- NFR-11 (a11y, reduced motion), NFR-12 (i18n/ICU), §4.2 widget SDK contract all apply.

## Decision

### Frontend

We will add a `streaks` widget under `apps/web/widgets/streaks/`, registered in the client-side
registry per §4.2, wrapped in the standard error + suspense boundaries. It renders a vertical list
of streak rows (count, name, 7-day activity dots) and a footer line for the all-time best, matching
the mock. Data comes from one generated hook (`useStreaks()` from `packages/contracts`) — the
widget is a **read-only aggregation view**; it performs no writes.

- `settingsSchema` (zod): `{ visible: streakKey[] (default: all), order: "current-desc" | "manual",
manualOrder?: streakKey[], showBest: boolean (default true) }` — drives the auto-generated
  settings panel.
- `quickActions`: **none.** There is no meaningful one-tap action on an aggregate of other widgets'
  activity; "do the thing" belongs to the source widget (e.g., the tech-lesson card's "Mark
  learned" or the WOTD card's "Add to Anki").

### Backend

We will keep all streak logic in a `StreaksService` inside `LearningModule`. It subscribes to
existing per-domain events on the in-process event bus — `task.completed`, `mood.checkin_recorded`,
`journal.entry_created`, `wotd.studied`, `grammar.studied`, `lesson.completed` — via a declarative map
`EVENT_TO_STREAK: Record<eventKey, streakKey | (payload) => streakKey>` local to the service
(a function entry derives per-instance keys from the payload, e.g. `lesson.completed` →
`tech-lesson:{track}`). Event payload types live in
`packages/contracts`, so no module imports another (§4.1 rule). We deliberately reject a generic
`activity.recorded` event emitted by source modules: that would make every emitter streak-aware and
put the coupling on the wrong side. Adding a streak = one map entry; emitters never change.

On each mapped event the service normalizes to `{ userId, streakKey, localDate }` (local date
computed from the event timestamp in the user's home timezone, see below) and records the day.

**Rollover (ADR-005 pg-boss):** the worker's per-minute tick enqueues one `streak.rollover` job per
user whose local clock passes **03:05**, with idempotency key `rollover:{userId}:{localDate}` —
pg-boss dedupes, and the handler itself is a pure function of table state (it compares
`last_active_date` against the closed date and zeroes `current_len` only if older), so re-running a
slot is a safe no-op (NFR-3 pattern).

**Timezone rule (resolves §8 Q1 for streaks):** we store a single IANA home timezone on the user
profile (`users.timezone`) and define the streak day _only_ in that zone. DST is handled by tz-aware
date math (a 23/25-hour day is still one day). While travelling, days keep following home time — a
stable, predictable rule; the alternative (device timezone) can skip or double-count days on a
flight and is unverifiable server-side.

**Grace window (retroactive/late activity):** the streak day ends at **03:00 local**, not midnight.
An entry logged at 00:30 counts for the calendar day that just ended — journaling after midnight is
the norm, not an exception, and a strict-midnight rule would punish exactly the behaviour the app
wants to encourage. Activity between 00:00–03:00 credits _yesterday only_; doing it again later
credits today. No further backfill: activity older than the grace window never revives a broken
streak (keeps the model honest and the rollover simple).

### Data model

We will keep the §4.4 `streaks` table as the read model, adding `UNIQUE (user_id, widget_id)` and
`updated_at`, and add one owned companion table for per-day marks (needed for the 7-dot display and
for idempotency):

```sql
streak_days (
  user_id    uuid  NOT NULL REFERENCES users,
  streak_key text  NOT NULL,          -- matches streaks.widget_id
  local_date date  NOT NULL,          -- day in the user's home tz
  PRIMARY KEY (user_id, streak_key, local_date)
)
```

Recording a day is `INSERT … ON CONFLICT DO NOTHING`; duplicate events (at-least-once bus delivery,
two tasks completed the same day) are naturally idempotent. `current_len` / `best_len` are updated
in the same transaction. RLS on both tables per §5.1. This extends §4.4; the ARD ER diagram gets a
follow-up edit.

### API contract

One read endpoint, one round trip (NFR-2):

```
GET /api/v1/streaks →
{ timezone: "Europe/Helsinki",
  streaks: [ { streakKey: "japanese-wotd", currentLen: 12, bestLen: 20,
               lastActiveDate: "2026-07-13", activeToday: true,
               last7: [true,true,true,false,true,true,true] } ] }
```

`last7` is oldest-first, computed from `streak_days` in the user's home tz. Display names for
`streakKey` come from the i18n catalog, not the API. No write endpoints — writes happen only via
domain events. Contract schema in `packages/contracts` (zod), served via the OpenAPI-generated
client (ADR-007).

### Accessibility

- The list is a real `<ul>`; each row is an `<li>` whose accessible text reads the full meaning:
  "Japanese — 12-day streak, best 20, active today." The big number is visual emphasis only — the
  same information exists as text, never conveyed by font size alone.
- The 7-day dots are `aria-hidden` decoration; their content is available as text ("active 6 of the
  last 7 days") in the row's accessible name.
- "Not done yet today" is signalled by a hollow flame icon **plus** the text "today pending" — never
  by colour alone (WCAG 1.4.1).
- Milestone celebration: **yes, but quiet** — at 7/30/100/365 days the row shows a one-time badge
  ("30 days!") with a brief shimmer. Under `prefers-reduced-motion` the shimmer is dropped and only
  the static badge renders (NFR-11). No confetti, no sound, no modal.

### UX states & interaction

- **Loading:** skeleton of 3 rows matching the final layout (number block + two text lines) inside
  the widget's suspense boundary — no spinner, no layout shift.
- **Empty:** "No streaks yet. Streaks start automatically the first time you complete a task, log
  your mood, journal, or study a lesson — come back tomorrow to see day 2." Explains the mechanic;
  no setup step exists or is implied.
- **Error:** standard fallback card from the widget error boundary with a retry button; the rest of
  the dashboard is unaffected (§4.2 isolation, NFR-4).
- **"At risk" nudge: no.** We will _not_ show alarm styling, countdowns, or push notifications for
  streaks about to break. The only signal is the passive "today pending" state above. Rationale:
  this app tracks mood and journaling; loss-aversion mechanics that make users anxious about the
  tool are self-defeating here. Users who want a reminder can create one explicitly via the
  Automation widget — opt-in pressure, never ambient pressure. Corollary: broken streaks show
  neutrally ("0 days — best 20"), never with shame copy.
- **i18n:** all copy externalized (NFR-12); counts via ICU plurals, e.g.
  `{count, plural, one {#-day streak} other {#-day streak}}` and
  `{count, plural, one {# day} other {# days}}`, so FI/JA localization later needs no code changes.

## Consequences

- Adding a streak source is one line in `EVENT_TO_STREAK` plus i18n strings; source modules stay
  streak-unaware. The event bus becomes load-bearing for correctness, though: an unmapped or renamed
  event key silently stops a streak — mitigated by a contract-level test asserting every map key is
  a published event.
- `streak_days` grows unbounded (~365 rows/streak/year — trivial at personal scale) but buys
  idempotency, the dots display, and a future calendar/heatmap view for free.
- The 03:00 grace boundary and home-timezone rule are now product semantics: the mood widget's
  "today" (midnight-based) and the streak's "today" can disagree between 00:00–03:00. Accepted;
  documented in the empty/pending copy if it ever confuses.
- Changing the home timezone shifts day boundaries; we accept minor artefacts (a possibly long/short
  day at the moment of change) rather than recomputing history.
- No at-risk nudge means some streaks will break that a notification could have saved. Deliberate
  trade: user wellbeing over engagement metrics.

## Alternatives considered

- **Compute streaks on read from source tables (no `streaks` state).** Rejected: requires
  `LearningModule` to query tables owned by Tasks/Mood/Journal, violating §4.1 ownership; also makes
  reads expensive and the rollover job pointless.
- **Generic `activity.recorded` event emitted by source modules.** Rejected: inverts coupling —
  every emitter must know it feeds a streak and which key; the subscriber-side map keeps emitters
  clean.
- **Strict local-midnight day boundary, no grace.** Rejected: punishes 00:30 journaling, the most
  common late activity; maximizes exactly the streak anxiety we chose to avoid.
- **Device timezone instead of stored home timezone.** Rejected: unverifiable server-side, lets a
  flight skip or double-count a day, and the worker (§4.5) needs a deterministic zone to schedule
  rollover without a client present.
- **"At risk" push notification at ~21:00.** Rejected as a default (anxiety mechanic, §5.2 push-
  content posture); available opt-in through the existing Automation module instead.
- **Bitmask/array column for last-7 instead of `streak_days`.** Rejected: loses event idempotency
  (ON CONFLICT) and history beyond 7 days for negligible savings.
