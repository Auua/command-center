# ADR-015: Reminders / Automations widget

- **Status:** proposed
- **Date:** 2026-07-13

## Context

Phase 2 delivers the automation engine: `AutomationModule` (ARD §4.1), the `automations` +
`automation_runs` tables (§4.4), and the worker cron-tick → pg-boss → Web Push pipeline (§4.5,
ADR-005). Those decisions stand; this ADR does not revisit them. What is undecided is the **widget**
— the read/manage surface on the dashboard, sketched in `docs/design/dashboard-mock.html` as a
"Today's reminders" card: time + label rows, per-row toggle switches, and an "Add automation"
header action.

Open questions this ADR must settle:

- How "today's reminders" is computed from `cron_expr` rows — and where (client vs server), given
  Q1 (timezones/DST) says the worker already evaluates tz-aware.
- How a user creates and edits an automation. A cron expression is not an acceptable end-user
  input, but `cron_expr` is what the engine consumes.
- What the enable/disable toggle means, and how it behaves optimistically (NFR-3 semantics live in
  the worker; the widget must not fake them).
- How run history (`automation_runs`) is surfaced so "did my reminder fire?" is answerable at a
  glance, including the "fired but push failed" case.
- Push-permission UX: Web Push needs `Notification.requestPermission()`, which browsers punish when
  requested on load; iOS grants it only to installed PWAs (R4). §2 already names the in-app
  notification bell as the fallback.
- v1 actions are notify-only (§5.3) — the builder must not imply otherwise. Push bodies must stay
  non-sensitive (§5.2).

Constraints inherited: widget SDK conformance (§4.2 — registry entry, error + suspense boundaries,
`settingsSchema`, `quickActions`), REST `/api/v1` through the API only (ADR-004/007), a11y NFR-11,
i18n NFR-12.

## Decision

### Frontend

We will ship a `reminders` widget under `apps/web/widgets/reminders/` with one registry entry,
conforming to `WidgetDefinition`:

- `id: "reminders"`, sizes `4×2` (mock) and `4×3`; wrapped in the shell's error boundary and its
  own suspense boundary — skeleton while loading, fallback card on crash.
- `quickActions: [{ id: "add-automation", label: t("reminders.add") }]` — the "+" in the widget
  chrome opens the builder modal.
- `settingsSchema` (zod): `{ maxRows: number (default 6), showEventAutomations: boolean (default
true), hourCycle: "h12" | "h23" | "auto" (default "auto") }`.
- Data via TanStack Query hooks generated into `packages/contracts`; no direct Supabase access.

The card renders two groups: **timed slots for today** (sorted by time) and, below a divider,
**event automations** ("after finishing any task" — the ⚡ rows in the mock), which have no time
column. Each timed row shows: time, name, per-slot status glyph (see UX states), and the enable
switch. A row past its slot time shows its run outcome inline ("sent 08:00 ✓").

### Backend

We will keep all logic in `AutomationModule` and add a thin read model for the widget:

- **Server-side today-expansion.** `GET /api/v1/automations/today` expands each enabled and
  disabled `time`/`recurring` automation's `cron_expr` into today's occurrence slots **on the
  server**, in the user's stored IANA timezone (the same `cron-parser` + tz evaluation the worker
  uses — one implementation, exported from the module, so widget preview and firing can never
  disagree, including across DST transitions). The endpoint joins `automation_runs` for today so
  each past slot carries its `sent | failed | skipped` status. The client never parses cron.
- **Toggle = whole automation.** `enabled` flips the `automations.enabled` column; the worker's
  due-query already filters on it (§4.5). Disabling suppresses all future slots; already-enqueued
  jobs for the current minute may still fire (at-least-once, NFR-3) — accepted and documented in
  the toggle's announcement copy ("Paused from next occurrence").
- Templates are a static server-side list (`GET /api/v1/automations/templates`) so copy/schedules
  version with the API, not the bundle.

### Data model

We will add one column to `automations` (§4.4 schema otherwise unchanged):

- `schedule jsonb` — the structured, user-editable schedule descriptor:
  `{ type: "daily" | "weekly" | "interval", time: "HH:mm", days?: [1..7], everyMinutes?: number }`.
  The API compiles `schedule → cron_expr` deterministically on create/update; `cron_expr` remains
  the engine's sole input (worker untouched), `schedule` is the sole input for the edit UI. This
  avoids lossy cron→UI decompilation ("0 12 * * 1-5" round-trips as "12:00, weekdays").
- `action` jsonb stays notify-only in v1: `{ type: "notify", title, body? }`. Titles are validated
  as short plain text; the builder copy warns that notification text is visible on the lock screen
  (§5.2 — no journal/mood content in bodies).
- `automation_runs` is read as-is; no schema change.

### API contract

All under `/api/v1`, zod schemas in `packages/contracts`, OpenAPI-generated client (ADR-007):

- `GET /automations` — full list (management view / settings panel).
- `GET /automations/today` — `{ slots: [{ automationId, name, at (ISO, user tz), enabled, run?:
{ status, firedAt } }], events: [{ automationId, name, eventKey, enabled, lastRun? }] }`.
- `POST /automations` — `{ name, kind, schedule? , eventKey?, action }`; server compiles cron.
- `PATCH /automations/:id` — partial; `{ enabled }` is the toggle path.
- `DELETE /automations/:id`.
- `GET /automations/:id/runs?limit=20` — history list for the edit modal's "Recent activity" tab.

### Accessibility

- **Toggle:** a native `<input type="checkbox">` with `role="switch"`, visually styled as a
  switch — the native `checked` state maps to the switch's on/off for assistive tech, and
  Space/click toggling, focus, and form semantics come free from the input. Labelled with the
  automation name — accessible name `"{name} reminder"`, state conveyed by the checked/switch
  state, never a bare "enabled" label. The mock's
  `aria-label="… enabled"` (state baked into the name) is corrected: name = identity, state =
  `aria-checked`.
- **Row layout:** the row is _not_ one click target. The name is a button that opens the edit
  modal; the switch is a separate ≥ 44×44 px target; row background is inert. No
  click-row-flips-toggle behavior.
- **Announcements:** an `aria-live="polite"` region in the widget announces toggle results
  ("Hydration break paused"); optimistic rollbacks ("Couldn't pause Hydration break — restored")
  are failures and use `role="alert"`, per the house pattern (errors alert, successes polite).
- **Builder modal:** focus trapped, `Esc` closes (confirming first if the form is dirty, matching
  ADR-018's dialog rule), focus returns to the invoking control ("+" button or row name). Time
  entry is a native `<input type="time">`; day-of-week selection is a `<fieldset>` of labelled
  checkboxes (chips visually), not divs with click handlers. Everything reachable and operable by
  keyboard alone.
- **Not color-only:** disabled rows get dimming _plus_ a visible "Paused" text token and the
  switch's off position; slot status uses glyph + text ("✓ sent", "! not delivered"), meeting
  WCAG 2.1 AA contrast in both themes.
- **Motion:** switch-thumb travel, modal open/close transitions, and skeleton shimmer are all
  disabled under `prefers-reduced-motion` (NFR-11) — state changes render as instant swaps.

### UX states & interaction

- **Loading:** five ghost rows (time pill + name bar + switch), no layout shift on hydrate.
- **Empty (first run):** one paragraph explaining what automations do ("Command Center can nudge
  you — on a schedule, or after events like finishing a task") plus one-tap starter templates:
  "Hydration break (12:00 daily)", "Afternoon mood check-in (15:00)", "Journal before bed (21:30)".
  Tapping a template creates it enabled and opens the edit modal pre-filled.
- **Error:** fallback card with retry; the shell's error boundary catches render crashes.
- **Toggle:** optimistic flip → `PATCH`; on failure, revert and announce via the live region. No
  spinner on the switch itself (state is the feedback); the row shows a subtle pending style until
  settled.
- **Creation/edit: modal builder,** not inline quick-add. Fields: name → "When" segmented choice
  (_At a time_ → time + Every day / Weekdays / Weekends / Custom days; _After an event_ →
  select from known event keys, e.g. `task.completed`) → notification text. The action type is
  fixed to "Send me a notification" (v1 notify-only, §5.3) and rendered as static text, not a
  disabled dropdown pretending at more. Cron never appears anywhere in the UI.
- **Delivery state & push permission:** permission is **never requested on load**. If permission
  is `default` and ≥ 1 timed automation is enabled, the widget shows a dismissible inline banner
  with an explicit "Enable notifications" button — the only call site of
  `Notification.requestPermission()` + push subscription (`POST /notifications/subscriptions`,
  NotificationModule). If **denied**, or on **iOS Safari without an installed PWA** (detected via
  `display-mode: standalone`), the widget shows an "In-app only" badge: reminders still fire and
  land in the notification bell (§2 fallback table, R4), and the iOS case links a one-line
  "Install to Home Screen to get push" hint. A slot whose run is `failed` (push endpoint errored)
  renders "! not delivered — check the bell", distinguishing engine-fired from user-received.
- **i18n:** all copy through the app's message catalog (NFR-12); times formatted with
  `Intl.DateTimeFormat` in the user's locale and stored timezone, honoring the `hourCycle` setting.

## Consequences

- One schedule-evaluation implementation serves worker and widget, so the card's "today" view is
  correct by construction across DST — but the today endpoint is now on the module's hot path and
  must stay under NFR-2 (cheap: one user's automations is tens of rows, expansion is in-memory).
- `schedule jsonb` becomes the editing source of truth; `cron_expr` is derived. Any future hand-set
  cron (admin/SQL) won't round-trip into the builder — acceptable for a personal app; the compile
  step is the single write path.
- The modal builder is more code than a quick-add line but gives event-kind automations, day
  pickers, and validation a place to live; templates cover the "fast first reminder" need instead.
- Notify-only is baked into the builder as static text; adding webhook/Home Assistant actions later
  (§5.3 revisit) means a real action selector plus a security review — deliberately not scaffolded
  now.
- Permission-on-gesture and the in-app-only badge commit us to the notification bell existing in
  Phase 2, as §2 already implies; the widget is honest about degraded delivery rather than
  silently dropping pushes.
- Correcting the mock's switch labelling (`"… enabled"` → name-only + `aria-checked`) means the
  mock is not the a11y reference; this ADR is.

## Alternatives considered

- **Client-side cron expansion** (ship `cron-parser` to the browser): duplicates tz/DST logic in a
  second runtime; widget preview could disagree with what the worker fires (Q1). Rejected.
- **Raw cron input, even as an "advanced" field:** hostile to the actual user, invites expressions
  the builder can't re-render, and adds a validation surface for no v1 need. Rejected outright.
- **Inline natural-language quick-add** ("water every day at 12"): parsing is locale-dependent
  (NFR-12), errors are invisible until a reminder misfires, and event-kind automations don't fit a
  one-liner. The tasks widget's quick-add syntax works because a mis-parsed tag is harmless; a
  mis-parsed schedule is a missed reminder. Rejected in favor of modal + templates.
- **Decompiling `cron_expr` back into the edit UI** instead of adding `schedule jsonb`: lossy and
  fragile for anything beyond trivial expressions; a stored descriptor is one jsonb column.
  Rejected.
- **Per-slot toggles** (skip just today's 15:00): ambiguous against the `enabled` column and the
  worker's due-query; "skip once" can arrive later as a distinct, explicit action. Rejected for v1.
- **Requesting notification permission on dashboard load:** browsers auto-suppress unsolicited
  prompts, users reflex-deny, and a deny is near-permanent. Request only from the widget's explicit
  "Enable notifications" action. Rejected.
- **Custom div-based switch with `role="switch"` and JS key handling:** re-implements what a native
  checkbox gives for free (focus, Space toggling, form semantics). Style the native input instead.
  Rejected.
