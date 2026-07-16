# ADR-018: Calendar Widget (daily/weekly/monthly views)

- **Status:** proposed
- **Date:** 2026-07-13
- **Review:** claude-reviewed — pending product-owner approval

## Context

The README scopes a calendar with daily/weekly/monthly views; the ARD places `CalendarModule` among the domain modules (§4.1), lists `calendar_events` as a user-owned Postgres table (§4.3/4.4), and schedules the work for Phase 4 (§9). The dashboard mock does not include a calendar card, so this ADR defines the widget from the ARD and README, keeping the mock's visual language (card-head with kicker, ghost settings button, quick actions in the chrome).

Forces at play:

- **Module boundaries (ADR-002).** Task deadlines are calendar-shaped data, but tasks belong to `TasksModule`. Domain modules must not import each other; any composition happens over events or at the API-consumer layer.
- **Recurrence is the hard 20%.** "Every second Tuesday" is easy to store and notoriously easy to expand wrong (DST, COUNT vs UNTIL, week-start rules). Whatever we pick must not leak broken expansion logic into every client.
- **Timezones and all-day events.** The classic bug: an all-day event stored as a midnight timestamp shifts to the previous day when viewed from a different timezone. NFR targets a travelling single user (see also ARD Q1), so this must be designed away, not patched.
- **Accessibility (NFR-11).** Date-grid UIs are one of the hardest WCAG patterns; a month grid that is mouse-only or hides events from screen readers would fail the NFR outright.
- **i18n (NFR-12).** The owner is in Finland: weeks start on Monday, and month/day names must not be hardcoded English.
- **Scope pressure.** External calendar sync (Google, CalDAV) is the most-requested calendar feature everywhere, and also the largest source of complexity (OAuth token refresh, webhooks/polling, conflict resolution) — a poor fit for NFR-8 (cost) and G2 (low ops) in a first cut.
- **Widget vs destination tension (§4.2).** The dashboard is a glanceable grid; a month view wants a full page. The widget contract supports multiple sizes, but no size makes a 7×6 date grid both readable and keyboard-navigable inside a card.

## Decision

### Scope

We will ship v1 as **own-events CRUD only**: create, edit, delete events (including recurring ones) that live in our Postgres. **External calendar sync (Google Calendar, CalDAV/ICS subscription) is explicitly deferred.** Sync demands OAuth consent flows, refresh-token custody, webhook or polling infrastructure in the worker, and a read-only-vs-two-way policy — each a bigger project than the calendar itself, and none needed to validate the widget. The data model below keeps a clean seam for it (an eventual `source`/`external_id` pair on `calendar_events`), so deferral costs nothing structurally. _(The deferral is lifted for Google Calendar by ADR-037, which pays exactly these costs and uses exactly this seam; CalDAV/ICS stays deferred.)_

Task deadlines: **the calendar read endpoint stays pure** — it returns only `calendar_events` rows. The _widget_ optionally overlays task deadlines by fetching `GET /api/v1/tasks?dueFrom&dueTo` client-side (a `TasksModule` endpoint) and merging in the view layer, gated by a `showTaskDeadlines` setting. No cross-module import, no event-driven projection table to keep in sync; deadlines render as read-only markers that deep-link to the tasks widget, never as editable calendar events. _(ADR-036 extends this same endpoint with server-projected occurrences of recurring tasks, marked `projected: true` — still read-only markers, still no projection table.)_

### Frontend

- **Widget vs full view.** The dashboard widget is a **compact agenda**: today plus the next 7 days as a chronological list, in the mock's card pattern (card-head with kicker "CALENDAR", ghost settings icon button), supporting `2x2` and `4x2` grid footprints (the same size vocabulary every widget uses). In `2x2` it shows today only; in `4x2` the rolling week. Each row: time (or "all day"), title, and a category dot with visible text label. The **month/week/day grids live in an expanded view** at `/calendar` (a real route, so it is linkable, refresh-safe, and gets browser history for view/date navigation — `/calendar?view=month&date=2026-07-01`); the widget's header links to it. A month grid at dashboard-card size is unreadable and un-navigable — we don't pretend otherwise.
- **SDK conformance (§4.2).** One folder under `apps/web/widgets/calendar` plus a registry entry — the standard extension recipe. `WidgetDefinition`:
  - `id: "calendar"`, `sizes: ["2x2", "4x2"]`, error boundary + suspense boundary like every widget;
  - `settingsSchema` (zod): `defaultView: "agenda" | "day" | "week" | "month"` (default `agenda`; applies to the expanded view's landing state), `weekStartsOn: 0..6` (default 1 = Monday), `showTaskDeadlines: boolean` (default true) — drives the auto-generated settings panel;
  - `quickActions: [{ id: "new-event", label: "New event" }]` opening the create dialog directly from the widget chrome.
- **Data access** through generated hooks in `packages/contracts` (ADR-007); TanStack Query keyed by `["calendar", from, to]` so navigating month → week → month hits cache. The expanded view prefetches adjacent months on idle to make paging feel instant without violating NFR-2 budgets.
- The expanded view shares components with the widget (the agenda list is the same component at both sizes) but is not itself a widget — it is a plain Next.js route that happens to be the calendar's "expanded size".
- **Views in the expanded surface:**
  - _Agenda_ — the same chronological list, unbounded scroll-forward; the SR-preferred default.
  - _Day_ — a single hour-track column; all-day events in a pinned strip above the track, never squeezed into the 00:00 slot.
  - _Week_ — seven hour-track columns starting on `weekStartsOn`; the all-day strip spans the top.
  - _Month_ — the 7×N date grid with per-day event chips and an overflow "+N more" that opens the day peek panel.

### Backend

`CalendarModule` in the NestJS monolith: thin REST controller, service owning recurrence expansion and validation, its own repository (no shared repos, per §4.1 rules). Specifics:

- The **expansion service is the module's one piece of real logic** and is unit-tested in isolation: DST spring-forward/fall-back in `Europe/Helsinki`, `COUNT` vs `UNTIL` termination, week-start-sensitive rules (`FREQ=WEEKLY;WKST=MO`), and exdate application.
- Input hardening beyond zod shape checks: the service parses the submitted RRULE with the same library used for expansion and rejects anything unparseable or unbounded-per-day (e.g., sub-hourly frequencies) at write time — bad rules are refused at the door, not discovered at read time.
- It emits no domain events in v1 and listens to none; if automations later want "remind me before an event", `AutomationModule` will consume a `calendar.event.upcoming` event emitted by the worker's scanner — out of scope here, but the pure read endpoint makes that scanner trivial (it calls the same expansion service).

### Data model

Postgres table `calendar_events`, owned exclusively by `CalendarModule`, RLS `user_id = auth.uid()` like every table (§5.1):

| column                      | type            | notes                                                       |
| --------------------------- | --------------- | ----------------------------------------------------------- |
| `id`                        | `uuid` PK       | default `gen_random_uuid()`                                 |
| `user_id`                   | `uuid` FK       | → `users`; RLS anchor                                       |
| `title`                     | `text`          | not null, non-empty                                         |
| `starts_at`                 | `timestamptz`   | timed events only (null when `all_day`)                     |
| `ends_at`                   | `timestamptz`   | timed events; `ends_at > starts_at` CHECK                   |
| `starts_on`                 | `date`          | all-day events only                                         |
| `ends_on`                   | `date`          | all-day events, inclusive; `ends_on >= starts_on` CHECK     |
| `all_day`                   | `boolean`       | not null default false                                      |
| `rrule`                     | `text`          | nullable; RFC 5545 RRULE for the series, else single event  |
| `exdates`                   | `timestamptz[]` | not null default `{}`; skipped occurrences                  |
| `location`                  | `text`          | nullable                                                    |
| `note`                      | `text`          | nullable, plain text (no rich text — that's Journal's game) |
| `created_at` / `updated_at` | `timestamptz`   | audit                                                       |

**All-day semantics decided:** all-day events are stored as **dates, not timestamps** — a CHECK constraint enforces that exactly one representation is populated (`all_day ⇒ starts_on/ends_on set, starts_at/ends_at null`, and vice versa). A birthday on July 14 is July 14 in Tokyo and in Helsinki; it is never converted through a timezone, so it can never shift. Timed events are stored as `timestamptz` (an instant) and _rendered_ in the user's home timezone (profile setting, same one automations use per ARD Q1).

**Recurrence level decided:** v1 stores an **RFC 5545 RRULE string** on the series row and supports whole-series edit/delete plus **"delete this occurrence"** via `exdates`. "Edit this occurrence" (detached overrides, RECURRENCE-ID) is deferred — it roughly doubles the model (override rows, reparenting on series edit) for a feature a personal calendar can live without initially. Index: `(user_id, starts_at)` and `(user_id, starts_on)` partial indexes for range scans.

### API contract

All under `/api/v1/calendar` (ADR-004: everything through the API), zod-validated at the contract layer with reject-unknown-fields on (§5.2):

- `GET /events?from&to` — **required** ISO-8601 range, **max span 366 days** (400 beyond). Returns **expanded occurrences**: for recurring series the server expands the RRULE over `[from, to)` with the `rrule` library, applies `exdates`, and caps at **500 occurrences per request** (400 with a "narrow the range" error if exceeded — protects against `FREQ=MINUTELY` foot-guns). Each occurrence carries:
  - `seriesId` (the row id), `occurrenceStart` (this instance's start), `isRecurring`;
  - either `startsAt`/`endsAt` (ISO instants) or `startsOn`/`endsOn` (plain dates) mirroring the storage split, so the client can never mistake one for the other.
- **Raw RRULEs are never expanded client-side**: one expansion implementation, one place to test DST edges, and the read contract stays "a list of concrete events" — which also keeps a future external-sync source indistinguishable to the frontend. The stored `rrule` is returned only on the single-event `GET /events/:id` used by the edit dialog (shown to the user as a human-readable summary, e.g. via `rrule`'s `toText()`).
- `POST /events` — create (timed or all-day, optional `rrule`; validation rejects rules the expander can't parse).
- `PATCH /events/:id` — edit the event or the whole series.
- `DELETE /events/:id` — delete the event/series; `DELETE /events/:id/occurrences/:occurrenceStart` appends to `exdates` ("delete this occurrence").

`user_id` always from the JWT, never the body (§5.1). Reads must meet NFR-2 (<200 ms p95); expansion of a personal calendar's few dozen series over ≤366 days is microseconds, so no materialized occurrence table in v1.

### Accessibility

The agenda list is the **screen-reader-preferred default view** (and the widget's only view) — a semantic `<ol>` of days, each with an `<h3>` date heading and a nested list of events. Grid views are additive, never the only path to the data. For the month grid in the expanded view:

- **Grid semantics:** `role="grid"` with `aria-rowcount`/`aria-colcount`, `role="columnheader"` weekday names (localized, full name in `aria-label` even when abbreviated visually), `role="gridcell"` per date. `aria-current="date"` on today's cell; days outside the displayed month are real cells (navigable), visually muted but still ≥4.5:1.
- **Roving tabindex:** exactly one tabbable cell at a time; Arrow keys move by day/week, `PageUp`/`PageDown` by month (`Shift+` by year), `Home`/`End` to week start/end honoring `weekStartsOn`. Focus follows month paging (landing on the same day-of-month, clamped). `Enter` opens the day; typing on a cell opens quick-create prefilled with that date.
- **Accessible names carry the data:** each cell's name is the full localized date plus event count ("Tuesday 14 July, 2 events") — a grid that visually shows event chips but exposes bare day numbers to SRs is the classic failure. Events within a day are additionally reachable as a real list (day peek panel with `<ul>` semantics and per-event links), not only as absolutely-positioned chips; in week/day views the underlying DOM order is chronological regardless of visual positioning.
- **View switching:** the day/week/month/agenda switcher is a labelled group of toggle buttons (`aria-pressed`), and view changes are announced via a polite live region ("Month view, July 2026").
- **Dialogs:** create/edit in a modal with focus trap, initial focus on the title field, focus returned to the invoking element on close, `Escape` cancels (with confirm if the form is dirty). Date/time pickers are progressive enhancements over native `<input type="date">`/`<input type="time">` — always keyboard- and SR-operable even if the custom picker fails to load.
- **Color:** event category colors meet 4.5:1 against card backgrounds in both light and dark themes (token pairs defined per theme, not one palette reused); category is never encoded by color alone — each event exposes its category as text in the accessible name and detail view, and all-day vs timed is conveyed by text ("all day"), not styling.
- **Motion:** view transitions (month slide, dialog scale) are disabled under `prefers-reduced-motion`; navigation is instant swaps (NFR-11).

### UX states & interaction

- **Loading:** per-view skeletons — agenda rows in the widget, a ghost 7×5 grid in month view, hour-track placeholder in day/week — inside the widget's suspense boundary so the shell never blocks (§4.5 dashboard-load flow).
- **Empty:** "Nothing scheduled — enjoy the quiet" for an empty day/week, with an inline "New event" affordance; empty month cells are just empty (no per-cell copy noise).
- **Error:** the widget's error boundary fallback card with retry, per §4.2 — never a blank dashboard. In the expanded view, a failed range fetch keeps the last-good range rendered with an error banner rather than blanking the grid.
- **Optimistic mutations:** create/edit/delete apply immediately via TanStack Query cache updates and roll back on failure with a `role="alert"` toast naming the event — a silent rollback is invisible to screen-reader users. **Delete gets an undo** (5 s toast; the DELETE fires after the window elapses or on toast dismissal) — destroying a recurring series is too costly for confirm-dialog-only. Per the shared undo pattern (ADR-008): the toast is announced via the polite live region, its Undo is a real focusable `<button>` in the tab order, and the countdown pauses while the toast has focus or hover (WCAG 2.2.1). Deleting anything recurring asks "this occurrence / whole series" first.
- **Timezone display rule:** timed events render in the user's **home timezone** (the profile-level setting shared with automations, ARD Q1) with an explicit indicator whenever the browser's timezone differs ("shown in Europe/Helsinki") so a travelling user is never silently looking at shifted times; all-day events render on their stored calendar date everywhere, by construction.
- **Event creation defaults:** quick-create from a grid cell prefills that date; from the widget it prefills the next round hour today; duration defaults to 1 h. Small, but it is the difference between a calendar that gets used and one that doesn't.
- **i18n (NFR-12):** all month/weekday names and date formats via `Intl.DateTimeFormat` with the user's locale; week start defaults to Monday (FI) via the `weekStartsOn` setting, overridable; UI copy (empty states, dialog labels, recurrence summaries) externalized like the rest of the app. No English string literals for dates anywhere.

## Consequences

Easier:

- The frontend never parses RRULEs — every client (widget, expanded view, a future mobile PWA surface) consumes concrete occurrence lists from one endpoint, and recurrence bugs have exactly one home.
- All-day shifting bugs are impossible by schema, not by discipline: there is no timestamp to mis-convert.
- External sync later slots in as another writer into `calendar_events` (plus `source`/`external_id` columns) without touching the read contract or any client.
- Task deadlines on the calendar cost zero backend work and zero consistency machinery; toggling the setting off removes the second request entirely.
- The agenda-first design gives screen-reader users the best view by default instead of a retrofitted one.

Harder / committed to:

- We own recurrence expansion correctness (DST edges, `UNTIL` vs `COUNT`, `WKST`) and pin the `rrule` library — its quirks become our contract, and upgrading it requires re-running the DST regression suite.
- "Edit this occurrence" will eventually force an override model — deferring it means a schema migration later. Acceptable: `exdates` already establishes the exception concept, and overrides layer on top (exdate the slot + a detached row) without rewriting existing data.
- The dual `starts_at`/`starts_on` representation makes every range query a two-branch predicate and the API shape a discriminated union; the repository and the zod contract each encode it once, so the complexity is contained but permanent.
- The client-side task overlay means two requests per calendar render when the toggle is on — fine at personal scale (NFR-2 is per-endpoint), revisit only if a real composite read-model need appears.
- The month grid a11y contract (roving tabindex, per-cell accessible names, chronological DOM order) is nontrivial and must be covered by Playwright + axe checks in the web e2e tier; shipping the grid without them would silently regress NFR-11.
- A new route (`/calendar`) slightly widens the app beyond "everything is a dashboard card"; this is deliberate and will be the pattern for other widgets that need a working surface (Journal took the same shape).

## Alternatives considered

- **External calendar sync in v1** — rejected: OAuth token custody, webhook/poll infra in the worker, and conflict policy dwarf the widget itself; violates G2/NFR-8 for a Phase 4 feature. Deferred with a schema seam, not abandoned.
- **Client-side RRULE expansion** (ship the rule, expand in the widget) — rejected: N implementations of the hardest logic, DST bugs per client, and the API contract stops being "a list of events", which breaks the future-sync and automation consumers. Server expansion with a horizon cap is strictly safer.
- **Materialized occurrences table** (worker pre-expands into rows) — rejected for v1: adds a projection to keep consistent on every series edit for zero measurable read benefit at single-user scale. Documented as the escape hatch if expansion ever threatens NFR-2.
- **Task deadlines via event-driven projection** (`TasksModule` emits, `CalendarModule` materializes shadow events) — rejected: creates a second source of truth that drifts on task edits/deletes and couples module lifecycles; the client-side overlay achieves the same pixels with no sync machinery and keeps ADR-002 boundaries intact.
- **Full recurrence with per-occurrence overrides in v1** — rejected: doubles data-model and edit-flow complexity (detached rows, "this and following" semantics) before the basic calendar has proven daily use. `exdates` covers the most common exception (skip one).
- **Month grid inside the dashboard widget** — rejected: at card sizes the grid degrades into an inaccessible postage stamp; agenda-in-widget + grid-in-route serves both the glance and the planning use cases honestly.
- **Adopting a full calendar UI library (e.g., FullCalendar)** — rejected as the primary path: heavyweight bundle for the dashboard, styling that fights the mock's design language, and its grid a11y still requires the same custom work to meet our contract. Headless date utilities plus our own views fit the widget SDK better; revisit only if the week/day hour-track proves disproportionately expensive to build.
- **Storing all-day events as UTC-midnight timestamps** — rejected: this is the bug, not a design. Date columns with a CHECK constraint make the invalid state unrepresentable.
