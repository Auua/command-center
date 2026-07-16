# ADR-008: Tasks (todo) widget

- **Status:** Accepted
- **Date:** 2026-07-13
- **Review:** claude-reviewed, PO-reviewed

## Context

Tasks is the first Postgres-backed domain widget (Phase 1 "daily core") and the reference
implementation other CRUD widgets will copy. It must realize the design mock's "Today's tasks"
card (checkbox rows, priority pills, due labels, quick-add hint), conform to the widget SDK
contract (ARD §4.2), respect the data-ownership split (§4.3–4.4: `tasks` lives in Supabase
Postgres, owned by `TasksModule`), route all traffic through the NestJS API (ADR-004), and feed
the Phase 2 automation engine via the `task.completed` event (§4.5). It also sets the bar for
NFR-11 (WCAG 2.1 AA) and NFR-12 (i18n) in an interactive widget — the clock and braindump widgets
exercised neither seriously. Most of this ADR is implemented (commit `dc12298` onward); where the
implementation falls short of the decision, the gap is called out inline as **Gap**.
_(ADR-036 extends this widget with recurring tasks: lineage columns on `tasks`, an `every …`
quick-add token, and respawn-on-completion semantics — this ADR's single-shot model remains the
base case.)_

## Decision

### Frontend

We will ship Tasks as one self-contained folder, `apps/web/widgets/tasks/`, registered in the
widget registry as `WidgetDefinition` id `"tasks"` (title "Today's tasks", sky accent, 2×2 and
3×2 sizes, `settingsSchema` currently an empty zod object as the extension point). The dashboard
shell — not the widget — provides the error boundary, suspense boundary, and card chrome, per
§4.2. Client state is TanStack Query under the `['tasks']` key; the widget renders the API's
order verbatim and never re-sorts locally, so FE and BE cannot disagree about ordering.

Quick-add is the only creation UI: a single text input parsed by a pure client-side parser
(`quick-add.ts`, `parseQuickAdd(input, now)`) — trailing `p1`–`p3` sets priority, `today` /
`tomorrow` / weekday names (next occurrence) set the deadline, `#tag` tokens anywhere become
tags, the remainder is the title. Parsing happens on the client so the request the API sees is
plain structured `CreateTaskRequest` — the syntax is a UI affordance, not an API concern, and
stays swappable. Discoverability comes from the placeholder/label showing a worked example
(`try "pay rent friday p1"`); **Gap:** no live token preview (pills echoing the parsed
priority/date/tags before submit) yet — target for when the syntax grows.

### Backend

We will keep tasks in `TasksModule` (controller → service → repository, per §4.1): thin
controller doing explicit zod `.parse` on bodies, business rules in `TasksService`. Two rules are
non-negotiable: `completed_at` is set from the server clock, never accepted from the client; and
a foreign or malformed task id is indistinguishable from a missing one (both 404 — no existence
oracle across users). Completing a task emits `task.completed`
(`{ userId, taskId, title, completedAt }`) on the in-process event bus; `AutomationModule`
subscribes in Phase 2 (§4.5 smart reminders). `TasksModule` imports no other domain module and
exposes no repository outside itself.

List ordering is owned by the repository (one place, index-friendly): completed grouped by
`completed_at`, open tasks by `priority` (nulls last), then `deadline` (nulls last), then
`created_at` desc — matching the mock's visual order.

### Data model

Postgres `tasks` (migration `supabase/migrations/0002_tasks.sql`), one row per todo, exactly as
§4.4 sketches: `id uuid PK`, `user_id uuid FK → auth.users (cascade)`, `title text` (1–500
chars, checked), `priority int` (1 highest–3, `null` = unprioritized), `tags text[]` (default
`'{}'`), `deadline date` (day-granular deliberately — tasks are not minute-scheduled; time-of-day
belongs to CalendarModule), `completed_at timestamptz` (null = open; doubles as the completion
flag — no separate boolean to drift), `created_at`/`updated_at` with trigger. Tags are a `text[]`
column, not a join table: tags are only ever read with their task, PostgREST offers no
multi-table transactions, and `mood_checkins` set the precedent (the ARD ERD was updated to
match). RLS is on with `auth.uid() = user_id` policies for all four verbs; the API uses the
RLS-respecting role, never `service_role` (§5.1). Index: `(user_id, completed_at)` for the list
query.

### API contract

REST under `/api/v1/tasks`, schemas in `packages/contracts/src/schemas/tasks.ts` and shared
FE/BE (ADR-001/007):

- `GET /api/v1/tasks` → `{ items: Task[] }`, pre-sorted (see Backend).
- `POST /api/v1/tasks` — `CreateTaskRequest` `{ title, priority?, tags?, deadline? }` → `Task`.
- `PATCH /api/v1/tasks/:id` — `UpdateTaskRequest`, partial, must change ≥1 field; `completed:
boolean` is the completion API and maps server-side to setting/clearing `completed_at` → `Task`.
- `DELETE /api/v1/tasks/:id` → 204.

Write schemas are `.strict()` (reject-unknown-fields, §5.2); tags are trimmed, capped (≤20 of
≤50 chars), and de-duplicated in the schema; `deadline` is a plain `YYYY-MM-DD` string and
`completedAt` an ISO datetime, so no timezone ambiguity crosses the wire. `user_id` comes only
from the verified JWT. The widget calls these through `apps/web/lib/tasks-api.ts`, which parses
every response with the same zod schemas — the client never trusts the wire.

### Accessibility

- **Toggle control:** a `<button role="checkbox" aria-checked>` per row — checkbox semantics
  (AT announces "checked/unchecked"), button behavior (Space and Enter both activate). Each
  carries a per-task `aria-label` ("Mark \"Water the plants\" complete/incomplete") so rows are
  distinguishable out of context; the check SVG is `aria-hidden`.
- **List semantics:** tasks render as `<ul>/<li>` so AT reports count and position. Delete is a
  separate labeled button ("Delete task: …"), reachable in the natural tab order — the keyboard
  model is plain Tab + Space/Enter, no roving-tabindex custom grid for a five-row list.
- **Quick-add:** visually-hidden `<label>` tied to the input, plus a visually-hidden submit
  button so "Enter adds a task" is real form semantics, not a keydown hack.
- **Announcements:** mutation failures render `role="alert"`; loading renders `role="status"`.
  Completion/undo state changes must be announced via a polite `aria-live` region ("Task
  completed. Undo available."). **Gap:** the live region for successful toggles is not yet
  implemented — today only errors and the checkbox's own `aria-checked` flip are announced.
- **Focus management:** completing a task keeps focus on its checkbox even as the row re-sorts;
  deleting replaces the row with a transient inline confirmation row whose Undo button takes
  focus (see UX states — this is the house delete-undo pattern; ADR-017 reuses it); when the
  undo expires or is dismissed, focus moves to the next row's checkbox (or the quick-add input
  when the list empties) so keyboard users are never dropped to `<body>`. **Gap:** delete
  currently lets focus fall back to the document.
- **Not color-alone:** overdue renders as text (`overdue · Jul 10`) plus color; priority pills
  carry text (`P1`); done rows get strike-through plus the "done" label. Focus rings are visible
  (`:focus-visible`), and strike-through/removal transitions are disabled under
  `prefers-reduced-motion` (NFR-11).

### UX states & interaction

- **Loading:** skeleton rows matching the list's layout (3 shimmering placeholder rows), inside
  the widget's suspense boundary so only this card skeletons. **Gap:** currently a text
  placeholder ("Loading tasks…"); replace with the shared skeleton primitive when `packages/ui`
  grows one.
- **Empty:** a one-line invitation ("Nothing on the list. Add your first task below.") — the
  quick-add input stays visible, so the empty state teaches the add path.
- **Error/degraded:** query failure renders an inline error line inside the still-mounted widget
  (the shell's error boundary is the last resort for render crashes, not fetch failures);
  mutation failures show a `role="alert"` line and leave the draft text intact for retry.
- **Optimistic updates + rollback:** toggle and delete apply to the `['tasks']` cache in
  `onMutate` (snapshot → mutate → rollback in `onError`, `invalidateQueries` in `onSettled`);
  create stays pessimistic (the row needs its server id and sort position). **Gap:** the current
  implementation is invalidate-on-success only, and disables every row while any mutation is in
  flight — target is per-task pending state with optimistic application.
- **Undo, not confirmation:** completing a task never asks "are you sure" — it completes
  immediately and offers a transient Undo (which issues `completed: false`; `AutomationModule`
  must treat `task.completed` as advisory accordingly). Delete likewise gets undo-via-recreate
  from the snapshot rather than a modal. In both cases Undo is a real `<button>` in the tab
  order (for delete, it sits in the inline confirmation row that takes the deleted row's place
  and receives focus), it is announced via the polite live region, and its timeout pauses while
  it has focus or hover (WCAG 2.2.1) — a transient control a keyboard user can't reach in time
  is no undo at all. **Gap:** undo affordance not yet built.
- **i18n:** all copy above (labels, errors, empty state, "done", "overdue") is EN-only today and
  must move to the externalized-copy mechanism when it lands (NFR-12 structure exists, content
  pending). Due labels already format through `toLocaleDateString(undefined, …)` so date
  rendering follows the user's locale; relative words ("today", "tomorrow") are copy keys.
  Quick-add day tokens are English keywords for v1 — acceptable for a single-user EN dashboard,
  revisit if FI/JA UI ships.

## Consequences

- The FE/BE seam is fully typed: the same zod schemas validate the API's input and the client's
  responses, so contract drift fails loudly at either edge. The cost is that every task-shape
  change touches `packages/contracts` first — deliberate friction (ADR-001).
- Server-owned ordering and server-set `completed_at` keep clients dumb and consistent, but mean
  even trivial re-orders round-trip; acceptable at personal-app list sizes (NFR-2 covers it).
- The `task.completed` event decouples Tasks from Automations, but with undo-instead-of-confirm
  the event can be "taken back" — Phase 2 must debounce or tolerate complete→undo→complete
  sequences (documented here so it isn't rediscovered as a bug).
- `text[]` tags make "rename a tag everywhere" and tag-based cross-widget queries clumsy — if a
  real tag taxonomy emerges, that's a new ADR and a migration.
- Day-granular `deadline` means "due at 17:00" (visible in the mock) is out of scope for the
  tasks table; time-of-day items belong to CalendarModule. The mock overlays calendar context we
  deliberately don't store here.
- Recording target UX (optimistic + undo + skeleton + live region) with explicit gaps commits us
  to closing them before Tasks is "done" — the ADR doubles as the widget's quality checklist.

## Alternatives considered

- **Native `<input type="checkbox">` per row** — freest accessibility, but styling the mock's
  custom check chip cross-browser fights `appearance: none` quirks, and the row needs a button's
  activation model anyway. `role="checkbox"` on a real `<button>` gives identical AT semantics
  with full styling control. Rejected on styling cost, kept as the fallback if the ARIA pattern
  ever misreports in a screen reader we care about.
- **Server-side quick-add parsing** (send the raw string, let the API parse) — would centralize
  the grammar and enable email/Siri-style capture later, but bakes an English micro-syntax into
  the API contract, makes zod validation vague (`{ raw: string }`), and kills the future
  token-preview UI which needs the parse client-side before submit. Rejected; revisit only if a
  second capture channel appears.
- **Confirmation dialog for complete/delete** — safest against slips but punishes the 50×/day
  happy path; industry consensus for todo apps is act-then-undo. Rejected in favor of undo.
- **Client-side sorting** — snappier re-orders without a refetch, but two sort implementations
  drift, and optimistic cache updates already give the instant feel. Rejected: one owner (the
  repository) for ordering.
- **`task_tags` join table** (the ERD's original sketch) — relationally purer and enables tag
  renames, but tags are never queried apart from their task and PostgREST can't wrap the
  two-table write in one transaction. Rejected for `text[]` (see migration 0002 header).
- **Supabase realtime subscription for live task updates** — permitted by ADR-004 and attractive
  for multi-device sync, but with one user on one screen it's dead weight; TanStack Query
  refetch-on-focus covers the stale-tab case. Deferred, not rejected — the RLS policies already
  make it safe to add.
- **Separate `completed boolean` + `completed_at`** — redundant state that can disagree; the
  nullable timestamp encodes both. Rejected outright.
