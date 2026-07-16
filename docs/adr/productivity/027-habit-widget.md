# ADR-027: Habit tracking widget

- **Status:** Accepted
- **Date:** 2026-07-14
- **Review:** claude-reviewed, PO-reviewed

## Context

The README lists habit tracking under "Future Extensions"; the ARD names it in G4 as a widget that must plug in "without core changes". This ADR plans it — nothing is implemented, and several questions are flagged for the product owner rather than pre-decided.

Habits sit awkwardly close to two things that already exist, and most of the design work is drawing those lines:

- **Streaks (ADR-014).** `StreaksService` already owns consecutive-day counting: it subscribes to domain events via `EVENT_TO_STREAK`, keys days off `streak_days` (idempotent `(user_id, streak_key, local_date)` PK), applies the 03:00-local grace boundary, and runs the pg-boss rollover job. A habit is _the archetypal streak source_. If `HabitsModule` computes its own streak lengths, we have two implementations of the same semantics, drifting on day boundaries.
- **Automations (ADR-015).** "Remind me to do my habit at 20:00" is exactly a time automation with a notify action. `AutomationModule` already compiles a `schedule` jsonb to cron, evaluates tz-aware in the worker, and owns the push-permission UX. A habit-local reminder scheduler would be a second, worse copy.
- **Wellbeing stance.** ADR-014 explicitly rejected "at risk" nudges as a loss-aversion dark pattern in an app that also holds mood and journal data. Habit trackers are the genre where that dark pattern is most standard (streak-freeze economies, red broken-chain UI). We must restate the position, because a habit widget is where it will be tested.

Also in play: the widget SDK (§4.2), the Postgres/Mongo split (§4.3 — habits are fixed-shape rows with count/filter queries, so Postgres), module rules (§4.1 — no cross-module imports, event bus only), NFR-11 (a11y), NFR-12 (i18n).

## Decision

### Scope

We will ship **user-defined recurring habits with binary or counted daily marks, and a heatmap history** — and nothing else. Explicitly out of v1: habit "stakes"/points, social features, streak freezes, and any notion of a habit score. A habit is: a name, a schedule (which days it's expected), an optional daily target count, and a history of marks.

### Frontend

One folder `apps/web/widgets/habits/` + one registry entry, per §4.2:

- `id: "habits"`, `sizes: ["2x2", "4x2", "4x3"]`; standard error + suspense boundaries.
- The card body is a list of today's expected habits: each row = habit name, a **check-off control**, and a compact 7-day dot strip. At `4x3`, rows expand to a 12-week heatmap grid per habit.
- `quickActions: [{ id: "new-habit", label: t("habits.new") }]` — opens the create dialog (name, days expected, optional target count).
- `settingsSchema` (zod): `{ showOnlyToday: boolean (default true), historyWeeks: 4 | 12 | 26 (default 12), sort: "manual" | "name" (default "manual") }`.
- The full **heatmap/history surface lives at `/habits`** (a real route, linkable, refresh-safe) following ADR-018's widget-vs-destination split. A 26-week grid is not readable in a dashboard card.
- Data through generated hooks in `packages/contracts` (ADR-007); no direct Supabase access (ADR-004).

### Backend

A new `HabitsModule` (domain module, §4.1): thin controller → service → own repository. It imports no other domain module.

- **Marking a habit emits `habit.marked`** (`{ userId, habitId, habitKey, localDate, count }`) on the in-process event bus. `StreaksService` (ADR-014) adds **one entry** to `EVENT_TO_STREAK` — a function entry deriving `habit:{habitKey}` from the payload, exactly the per-instance pattern `lesson.completed` → `tech-lesson:{track}` already uses. **`HabitsModule` computes no streak lengths and stores no `current_len`.** The widget reads streak numbers from `GET /api/v1/streaks` and joins client-side by `streakKey`, or (open question Q-A below) the habits endpoint composes them at the API layer.
- **Reminders are automations, not habit state.** Creating a habit offers "remind me" as a shortcut that `POST`s an `AutomationModule` automation (`schedule` jsonb, notify action) from the client — two API calls, no cross-module import, no habit-owned scheduler. The habit row stores at most the resulting `automation_id` as an opaque reference for the "reminder on/off" affordance; deleting the habit deletes that automation via its own endpoint.
- **Un-marking:** the day-mark is deletable (undo, ADR-008). Deleting a mark emits `habit.unmarked`; ADR-014's streak service currently has no un-record path. **This is a real gap** — see Consequences and Q-B.
- No rollover job of its own: expectation ("was this habit due today?") is derived on read from the schedule; missed days are simply absent rows.

### Data model

Postgres, owned solely by `HabitsModule`, RLS `user_id = auth.uid()` (§5.1):

```sql
habits (
  id           uuid PK default gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users,
  key          text NOT NULL,              -- stable slug, used in streak_key "habit:{key}"
  name         text NOT NULL,
  schedule     jsonb NOT NULL,             -- { type: "daily" } | { type: "weekly", days: [1..7] }
                                           --   | { type: "times_per_week", n: 1..7 }
  target_count int  NOT NULL DEFAULT 1,    -- 1 = binary check-off; >1 = counted (e.g. 3 glasses)
  archived_at  timestamptz,                -- soft-delete: history survives
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

habit_marks (
  user_id    uuid NOT NULL REFERENCES users,
  habit_id   uuid NOT NULL REFERENCES habits ON DELETE CASCADE,
  local_date date NOT NULL,                -- day in the user's home tz, 03:00 grace boundary
  count      int  NOT NULL DEFAULT 1 CHECK (count > 0),
  marked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, habit_id, local_date)
);
```

`habit_marks` deliberately mirrors ADR-014's `streak_days`: **the PK is the idempotency mechanism.** Marking is `INSERT … ON CONFLICT (user_id, habit_id, local_date) DO UPDATE SET count = habit_marks.count + excluded.count` for counted habits, and `DO NOTHING` for binary ones — a double-tap or an at-least-once retry can never create two rows for one day. `local_date` is computed **server-side** from the user's stored home IANA timezone with ADR-014's 03:00-local grace boundary, so a 00:30 check-off credits the day that just ended and habits and streaks always agree about what "today" is. Habits are **archived, never hard-deleted**, so the heatmap doesn't grow holes.

### API contract

Under `/api/v1/habits`, zod schemas in `packages/contracts`, `.strict()` on writes (§5.2):

- `GET /habits/today` → `{ localDate, items: [{ habitId, key, name, targetCount, count, done, streak?: { currentLen, bestLen }, last7: boolean[] }] }` — only habits expected today per their schedule.
- `GET /habits/:id/history?weeks=N` → `{ days: [{ localDate, count, expected: boolean }] }`, `weeks` ≤ 52. Server-computed `expected` so the client never re-derives the schedule.
- `POST /habits`, `PATCH /habits/:id`, `POST /habits/:id/archive`.
- `POST /habits/:id/marks` `{ localDate?, count? }` → the mark (idempotent per above). `localDate` is accepted only for **today or yesterday-within-grace**; older backfill is refused (400) — same honesty rule as ADR-014's "no backfill revives a streak".
- `DELETE /habits/:id/marks/:localDate` → 204 (undo).

`user_id` always from the JWT. Missing/foreign/malformed ids all return the same 404.

### Accessibility

- The today list is a real `<ul>`; each row's accessible name carries the full meaning ("Meditate — done today, 12-day streak"), never conveyed by a filled square alone.
- The check-off control is a **native `<input type="checkbox">`** for binary habits (state = `checked`, free keyboard/SR semantics — the ADR-015 switch rule) and a labelled `<button>` + live count for counted habits ("Water, 2 of 3 today. Add one."). Targets ≥ 44×44 px.
- **Heatmap** follows the ADR-009 chart pattern: the grid is `role="img"` with an `aria-label` summary ("Meditate: 41 of the last 84 expected days"), plus a **visually-hidden table** (date / done / expected) so values are individually navigable — the hidden-table target ADR-009 committed to, delivered here rather than deferred. Intensity is encoded by cell fill _and_ exposed as text; never color alone (WCAG 1.4.1). "Expected but missed" vs "not expected" are distinguished by border/pattern, not hue.
- Check-off confirmation announces via `role="status"`; failures via `role="alert"`. Any fill animation and any milestone shimmer are gated behind `prefers-reduced-motion` (NFR-11).
- All copy externalized; counts via ICU plurals (NFR-12).

### UX states & interaction

- **One tap marks, Undo reverses** — no confirm dialog, per the house undo pattern (ADR-008): a `role="status"` line ("Marked Meditate. Undo") with a real focusable Undo button whose timeout pauses on focus/hover (WCAG 2.2.1). Optimistic cache update in `onMutate`, rollback with a `role="alert"` on failure.
- **Loading:** skeleton rows matching the final layout. **Empty:** "No habits yet — add one and check it off daily. Streaks start automatically." **Error:** the widget's fallback card with retry; the rest of the dashboard is unaffected (§4.2, NFR-4).
- **Wellbeing stance — restated and binding: no guilt-tripping.** We will not ship "at risk" banners, countdowns, red broken-chain styling, shame copy, or any automatic push nudge for an unmarked habit. Missed days render **neutrally** (an empty cell, "not done" — not "failed"), and a broken streak reads "0 days — best 20". The only nudge mechanism is an **explicit, user-created reminder** through the Automation widget (ADR-015) — opt-in pressure, never ambient pressure. This is the same trade ADR-014 made and is inherited verbatim: a habit widget that makes you anxious about the tool is self-defeating in an app that also holds your mood data.
- `times_per_week` habits show progress ("2 of 3 this week") rather than per-day expectation, so a flexible habit never reads as "missed" on an off day.

### Open questions for the product owner

- **Q-A: who joins habits to streaks?** Either the widget calls `GET /streaks` and joins by `streakKey` client-side (zero coupling, two requests), or `HabitsModule` calls a read-only `StreaksService` query (one request, but a module dependency ADR-014 currently forbids). Default is the client-side join; flag before implementation. → _PO-review:_ client-side join, as defaulted.
- **Q-B: un-marking and streaks.** ADR-014's streak model is append-only (`streak_days` has no delete path). Un-marking a habit today should arguably retract the streak day _if no other source credited it_ — that requires `StreaksService` to gain a recompute-day operation. Options: (1) accept the drift (undo removes the mark, streak keeps the day), (2) extend ADR-014 with a `recomputeDay(userId, streakKey, localDate)` handler for `habit.unmarked`. Prefer (2), but it amends an existing ADR. → _PO-review:_ option (2) — `StreaksService` gains `recomputeDay` handling `habit.unmarked`; fold the amendment into ADR-014 at its (still pending) walkthrough.
- **Q-C:** counted habits (`target_count > 1`) — worth v1, or is binary enough? → _PO-review:_ counted habits ship in v1.

## Consequences

- **Adding a habit is one row, not one deploy** — unlike streak sources tied to code events, habits are user data, so `EVENT_TO_STREAK` needs a _function_ entry (`habit.marked` → `habit:{key}`), not one entry per habit. ADR-014's map already supports this shape; this is the first consumer to rely on it.
- Streak semantics stay in exactly one place: the 03:00 boundary, home-tz day math, and rollover job all come for free, and habits can never disagree with the streaks widget about "today".
- Reminders cost `HabitsModule` nothing — but the habit↔automation link is a loose reference (`automation_id`), so a user deleting the automation directly leaves the habit's "reminder on" affordance stale. Accepted at personal scale; the widget re-reads the automation to render the toggle.
- `habit_marks` grows ~365 rows/habit/year — trivial, and it buys idempotency, the 7-dot strip, and the heatmap from one table.
- We are committed to the no-guilt posture: any future "streak freeze", "at risk" push, or red-chain UI is a decision that must supersede both this ADR and ADR-014.
- Un-marking currently drifts from streaks (Q-B) — a known, documented inconsistency that must be closed before the widget ships, not after.

## Alternatives considered

- **`HabitsModule` computes its own streaks (`current_len`/`best_len` on `habits`).** Rejected: two implementations of day-boundary and grace-window semantics, guaranteed to drift; ADR-014 already solved this and its event map exists precisely to absorb new sources. The cost of reuse is one client-side join.
- **A habit-owned reminder scheduler (cron column on `habits`).** Rejected: duplicates `AutomationModule`'s tz-aware evaluator, its pg-boss dispatch, its idempotency keys, and its push-permission UX (ADR-015) — a strictly worse copy of a component in the same process. Habits create automations; they do not schedule.
- **Model habits as recurring tasks in `TasksModule`.** Superficially attractive (a habit _is_ a repeating to-do). Rejected: tasks are completed and gone, habits are marked and accumulate; the interesting queries are per-day-history and heatmaps, which would force `tasks` to grow a parallel mark table anyway. Also blurs "today's list" — 8 habit rows would drown the actual to-dos.
- **One row per mark with a surrogate `id` (no composite PK).** Rejected: loses free idempotency; a retried POST or a double-tap creates two rows and inflates counts. The `(user_id, habit_id, local_date)` PK makes the duplicate state unrepresentable, exactly as `streak_days` does.
- **Store habits in MongoDB.** Rejected by §4.3: fixed-shape rows queried with filters and aggregations (heatmaps, counts) are the Postgres column of the split, and Postgres RLS gives the second authorization net.
- **"At risk" evening push when a habit is unmarked.** Rejected as a default — the ADR-014 wellbeing position. Available opt-in via an explicit automation.
- **Hard-delete habits.** Rejected: it silently destroys history (and streak marks by cascade). Archive keeps the heatmap honest and the delete reversible.
