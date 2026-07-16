# ADR-036: Recurring tasks (and their projection onto the calendar)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Review:** claude-reviewed, PO-reviewed

## Context

The product owner wants recurring todos — "pay rent monthly", "water the plants every Sunday" —
and wants them visible on the calendar. ADR-008's `tasks` model is strictly single-shot, and the
calendar's task-deadline overlay (ADR-018) can only show deadlines that exist as rows, so a
recurring obligation currently has no honest representation: either the user re-types it forever
or fakes it as a far-future pile of copies.

Forces:

- **Habits are not recurring tasks, and vice versa.** ADR-027 rejected "habits-as-recurring-tasks"
  because habits are no-guilt day-marks with no deadline and no overdue state. The inverse holds
  here: a recurring _obligation_ (rent, filters, invoices) carries a deadline, a priority, and an
  overdue state — it belongs in Tasks. The two features complement; neither absorbs the other.
  Rule of thumb, recorded so it isn't re-litigated per feature: _if skipping it should nag you,
  it's a task; if skipping it should be forgiven, it's a habit._
- **Recurrence expansion is already solved once.** ADR-018 put RRULE expansion server-side in one
  tested place, precisely so no second implementation would drift. Whatever Tasks does must reuse
  that logic — but ADR-002 forbids `TasksModule` importing `CalendarModule`.
- **Two recurrence grammars already exist in the house.** ADR-015 compiles a structured schedule
  descriptor to cron for time-of-day reminders; ADR-018 stores RFC 5545 RRULEs for calendar
  events. Tasks must pick one, and the pick must fit day-granular deadlines (ADR-008 deliberately
  has no time-of-day).
- **The worker is not free.** Anything scheduled through the worker inherits the missed-tick /
  catch-up failure class NFR-3 exists to police. A CRUD feature should not acquire a cron
  dependency if a transactional design gets the same behavior (the reasoning that drove ADR-011's
  on-read day-pinning).
- **Calendar visibility must not materialize state.** ADR-018's overlay is deliberately
  read-composed with no projection table to keep in sync; recurring tasks shouldn't reintroduce
  one through the back door.

## Decision

### Semantics: one open occurrence per series; recurrence advances on completion

We will model a recurring task as **a normal open task that respawns when completed**. Exactly one
open occurrence of a series exists at any time. Completing it (`PATCH … completed: true`) does, in
one transaction: mark the row completed (server clock, per ADR-008), compute the next occurrence
date **strictly after the completion day** (user's home timezone, ARD Q1), and insert a fresh open
row with the same title/priority/tags, the new deadline, and the live rule. An uncompleted
recurring task simply goes overdue and _stays_ a single overdue item — missed occurrences do not
pile up, deliberately: a stack of five "water the plants (missed)" rows is a guilt generator
(ADR-027's posture) and drowns the list. Because the respawn is transactional with the completion
write, there is no worker, no cron, and no missed-tick failure mode: recurrence cannot be "late".

v1 rules are **schedule-based only** (every N days/weeks/months/years, weekday sets, month-day,
optional end after N times or on a date). Completion-relative recurrence ("3 days after I finish
it") is deferred — it needs no schema change (the spawn already keys off completion day) but does
need its own picker UX and semantics discussion.

### Recurrence vocabulary: RRULE, via a shared library — not a module import

We will store the rule as an **RFC 5545 RRULE string**, the same vocabulary as ADR-018, and
extract the expansion/next-occurrence logic (the `rrule` library plus the house validation and
DST test suite) into a **shared recurrence utility in `packages/`** consumed by both
`CalendarModule` and `TasksModule`. A shared _library_ is not a shared _domain module_ — no state,
no repository, no events — so ADR-002's boundary rule is intact. Cron (ADR-015's grammar) was
considered and rejected: "every 2 weeks" and COUNT/UNTIL termination are inexpressible in cron,
and tasks are day-granular like calendar events, not time-of-day like reminders. Task RRULEs are
expanded **in dates, not timestamps** (DTSTART is the deadline date), so the DST exposure ADR-018
had to test for timed events cannot arise here at all.

Validation mirrors ADR-018's reject-at-the-door: the API parses the rule with the same library
used for expansion and rejects unparseable rules and sub-daily frequencies (`HOURLY` and below)
at write time.

### Data model: lineage columns on `tasks`, no second table

Migration extends `tasks` (ADR-008) rather than adding a series table:

| column         | type         | notes                                                                                            |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `rrule`        | `text` null  | the live rule; carried by the open occurrence, snapshot on closed                                |
| `repeat`       | `jsonb` null | structured descriptor — the edit UI's source of truth (see below)                                |
| `series_id`    | `uuid` null  | lineage key; set to the row's own `id` when a task is made recurring, inherited by every respawn |
| `spawned_from` | `uuid` null  | FK → `tasks(id)` on delete set null; which completion produced this row                          |

CHECK: `rrule IS NOT NULL ⇒ deadline IS NOT NULL AND series_id IS NOT NULL` (a recurring task
without a deadline is meaningless — the deadline _is_ the current occurrence). A **partial unique
index** `UNIQUE (series_id) WHERE completed_at IS NULL AND series_id IS NOT NULL` makes the
one-open-occurrence invariant unrepresentable to violate, even under a retried completion request.
The series _is_ its open row: editing title/rule/priority edits the open occurrence and flows
forward via respawn; completed occurrences keep their snapshot (history is what actually happened).
Deleting the open occurrence ends the series; completed rows remain as ordinary history. RLS and
ownership are unchanged.

Following ADR-015's compile-don't-decompile pattern, the API accepts a structured `repeat`
descriptor (`{ freq, interval, byWeekday?, byMonthDay?, count? | until? }` — zod, in
`packages/contracts`), compiles it to `rrule` server-side, and stores **both**: `rrule` is the
engine's sole input, `repeat` is the edit UI's sole source — no lossy RRULE→picker decompilation.
Raw RRULE never appears in the UI (ADR-015: "cron never appears anywhere in the UI"; same rule,
new grammar). The edit dialog shows the compiled rule's human summary (`rrule`'s `toText()`,
localized copy key per NFR-12).

### Undo across a respawn

ADR-008's undo issues `completed: false`. For a recurring occurrence, un-completing additionally
**deletes the spawned successor iff it is still open and its `spawned_from` points at the restored
row**, and restores the rule to the restored row — transactional, so undo returns the world to the
pre-completion state. If the successor was already completed or deleted (possible only after the
undo toast is long gone), un-complete proceeds without touching it and the restored row comes back
non-recurring; the edge is documented in the service test suite rather than papered over with a 409. `task.completed` still fires per occurrence (streaks, ADR-014, unaffected), and Phase 2
automation consumers already must tolerate complete→undo sequences per ADR-008.

### Widget UX

- Open recurring tasks show a repeat glyph **plus text** (the `toText()` summary in the row's
  detail/tooltip and always in the accessible name: "Pay rent — repeats monthly"); never icon-only
  (NFR-11, not-color/symbol-alone).
- Quick-add grows an `every …` token (`every monday`, `every 2 weeks`, `every month`), parsed
  client-side into the `repeat` descriptor like every other token (ADR-008: the syntax is a UI
  affordance; the API sees structure). The token-preview gap noted in ADR-008 becomes more
  pressing with this addition and should be closed alongside it.
- Completing a recurring task announces the respawn in the polite live region ("Task completed.
  Next: Aug 1. Undo available.") — silently reappearing rows confuse screen-reader and sighted
  users alike.

### Calendar visibility: projected occurrences on the existing overlay

The calendar's task overlay endpoint (`GET /api/v1/tasks?dueFrom&dueTo`, ADR-018) additionally
returns **projected future occurrences** of each open recurring task, expanded server-side over
the requested range with the shared recurrence utility, marked `projected: true`, and capped
exactly like ADR-018's expansion (≤366-day span, occurrence cap). Projections are computed at
read time from the open row's rule — **no rows are materialized**, so there is nothing to drift
when the rule changes. The calendar renders them as it already renders task deadlines: read-only
markers deep-linking to the tasks widget, visually distinguished as tentative (and labelled so in
the accessible name — a projection is where the task _will_ land if the current one is completed
on time, since recurrence advances on completion). Clients never see or parse the rule (ADR-018's
one-expander principle).

## Consequences

- Recurrence acquires **zero scheduling infrastructure**: no worker job, no missed-tick class of
  bugs, no catch-up logic. The trade is semantic — "every Monday" completed on Wednesday spawns
  _next_ Monday, and an ignored task shows one overdue row, not a backlog. This matches how the
  major todo apps behave and is the wellbeing-aligned choice; if per-slot accounting is ever
  wanted, that's habit territory (ADR-027), not a tasks change.
- The partial unique index plus transactional respawn make double-spawn unrepresentable; the cost
  is that completion of a recurring task is now a multi-statement transaction owned by
  `TasksService`, and undo has real server logic and one documented edge (successor already acted
  on).
- The shared recurrence utility becomes load-bearing for two modules; ADR-018's DST regression
  suite moves with it and gates its upgrades. Library-level sharing keeps ADR-002 intact — but it
  is now a contract, not an implementation detail.
- Storing `repeat` alongside `rrule` repeats ADR-015's known trade: a hand-set `rrule` (SQL/admin)
  won't round-trip into the picker. Same acceptance, same reasoning.
- The overlay contract grows a `projected` discriminator; calendar and any future consumer must
  treat projected items as read-only and tentative. Two meanings now ride one endpoint — accepted
  because both are "task-shaped things with dates in a range" and a second endpoint would just
  duplicate the range/validation plumbing.
- ADR-008's schema and quick-add grammar are extended in place (this ADR is the record); the ARD
  §4.4 `tasks` sketch owes the new columns once approved.

## Alternatives considered

- **Worker-materialized future occurrences** (cron spawns the next N rows ahead) — rejected:
  inherits the missed-tick/catch-up failure class for a CRUD feature, litters the list with
  future rows the user didn't ask to see yet, and needs de-dup logic on every rule edit.
  Projection gives the calendar the same pixels statelessly.
- **Separate `task_series` table** (template + instance rows) — rejected at this scale: every
  list query becomes a join, create/edit flows fork into series-vs-instance paths, and the only
  payoff — per-occurrence overrides — is a feature todos don't need (an occurrence you want to
  change is just… edited; it respawns from the live rule next time). Kept as the escape hatch if
  override semantics ever materialize.
- **Respawn-by-update** (flip the same row back to open with the next deadline) — rejected: the
  completed occurrence vanishes from the done group and from history, `task.completed` would
  reference a row whose state mutated under it, and undo semantics get worse, not better.
- **Spawning every missed occurrence on catch-up** — rejected outright: a guilt backlog
  (ADR-027's dark-pattern line) and unbounded row growth for an abandoned rule.
- **Cron as the rule grammar** (reuse ADR-015's compiler) — rejected: cannot express biweekly or
  COUNT/UNTIL; cron's five fields encode time-of-day tasks deliberately don't have. RRULE is the
  day-granular vocabulary the house already tests.
- **Client-side projection expansion** (ship the rule to the calendar widget) — rejected for the
  same reason ADR-018 rejected client-side RRULE expansion: N implementations of the hardest
  logic, and the overlay contract stops being "concrete dated items".
- **Completion-relative recurrence in v1** — deferred, not rejected: the spawn point already keys
  off completion day, so it's additive; it just needs its own descriptor shape and picker UX.
- **Modeling recurring chores as habits instead** — rejected: no deadline, no priority, no
  overdue state, and ADR-027's no-guilt posture is wrong for obligations. The boundary rule in
  Context stands.
