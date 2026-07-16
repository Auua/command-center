# ADR-010: Braindump widget

- **Status:** proposed
- **Date:** 2026-07-13

## Context

Braindump is the "get it out of your head" widget: a quick-capture input on top of a
newest-first list of short notes (design mock `docs/design/dashboard-mock.html`, Braindump
card). Its entire value is **zero-friction capture** — the user decides to record a thought
and it lands, instantly, with nothing to configure and no way to lose the text. Everything
else (triage, promotion to a task, archiving) is secondary and must never slow capture down.

Architecturally it is load-bearing: it is the **first MongoDB-backed module** (ARD §9
Phase 1), so it validates the dual-DB ownership split (ADR-003), the Mongo repository
base class with enforced `userId` scoping (ARD §5.1), and the widget SDK contract (§4.2)
against a real read/write feature. The module and widget already exist
(`apps/api/src/braindump/`, `apps/web/widgets/braindump/`); this ADR records the decisions
they embody, and the target where the current implementation falls short.

Forces in tension:

- Capture speed vs. durability: clearing the input immediately feels instant but risks
  losing text if the POST fails; waiting for the server ack is safe but adds perceived lag.
- Document flexibility (notes may grow tags, archive state, promotion links) vs. a stable,
  minimal wire contract.
- Cross-domain "promote to task" vs. the hard module rule: domain modules never import
  each other (ARD §4.1).

## Decision

We will build Braindump as a self-contained widget + NestJS module pair: all data flows
through `/api/v1/braindump` with zod contracts in `packages/contracts`; MongoDB
`braindump_notes` is owned exclusively by `BraindumpModule`; the client never sees Mongo
(ADR-003/004). Capture is optimistic and loss-proof: submitted text is never discarded
until it is either persisted or explicitly abandoned by the user.

### Frontend

- One client component, `BraindumpWidget` (`apps/web/widgets/braindump/braindump-widget.tsx`),
  registered via the SDK `WidgetDefinition` (`index.ts`: id `braindump`, sizes 2×2 / 3×2,
  empty settings schema, sky accent) — full §4.2 conformance, wrapped by the shell's
  error/suspense boundaries like every widget.
- Data via TanStack Query over the typed client in `apps/web/lib/braindump-api.ts`; no
  direct Supabase/Mongo access from the widget (§4.2 data rule).
- **Capture semantics (the core promise):** Enter submits, Shift+Enter inserts a newline
  (multi-line thoughts allowed; textarea, not input). On submit the draft clears
  **immediately** and the note is appended optimistically at the top of the list in a
  "saving" state. If the POST fails, the optimistic row flips to an inline
  "Not saved — Retry / Edit" state: Retry re-posts the same content; Edit restores the
  text into the capture input. The text exists in exactly one place at all times — input,
  pending row, or saved note — and is never silently dropped.
  _Gap:_ the current implementation is server-ack-first — it clears the draft only in
  `onSuccess` and disables submit while pending, so text is safe but rapid-fire capture
  blocks on the network. Moving to the optimistic model above is the target; the
  invariant already held ("never lose input") stays the acceptance bar.
- No persistent offline queue (offline-first sync is an explicit non-goal, ARD §1.3);
  the retry affordance is in-memory for the session.
- **Promote to task:** a per-note quick action calls `POST /api/v1/tasks` (Tasks contract)
  and, on success, archives the note — **client-side API composition**, two sequential
  calls from the widget. `BraindumpModule` never imports `TasksModule`; if promotion later
  needs to be atomic or server-driven, the sanctioned path is a `braindump.promoted` event
  on the in-process event bus (§4.1), not a direct import. Not yet implemented; recorded
  here so it is not improvised as a cross-module call.

### Backend

- `BraindumpModule` (`apps/api/src/braindump/`): thin controller → service → repository,
  matching the module template in ARD §4.1. Validation is explicit zod `.parse` with
  `.strict()` on write bodies (reject-unknown-fields, §5.2); zod errors become 400s via
  the global exception filter.
- `BraindumpRepository` extends `UserScopedRepository`, so **every** query — list, insert,
  update, delete — carries the `userId` from the verified JWT; ids from the URL are only
  ever combined with that filter, so a foreign or malformed id yields 404, never a leak.
- Index `{ userId: 1, createdAt: -1 }` backs the list query; index creation is
  best-effort at boot so the API still starts when Atlas is down (§2 failure posture).

### Data model

- Collection: `braindump_notes` (MongoDB Atlas), sole owner `BraindumpModule` (§4.3/§4.4).
  Document: `{ _id, userId, content, createdAt, updatedAt }`. Document-shaped and
  schema-flexible on purpose: planned optional fields `archivedAt` (soft archive, so
  triage is reversible) and `promotedTaskId` (opaque cross-DB reference per the
  no-cross-DB-joins rule) can be added without a migration or contract break.
- The shape-based split holds: notes are unstructured free text with no relational
  queries, aggregations, or realtime needs — the Postgres column list in §4.3 gains
  nothing from them, and Mongo's flexible documents fit the "grow fields later" plan.
- List reads are capped at the newest 200 notes — a widget, not an archive browser.
- _Gap:_ delete is currently hard delete. Target is archive-first (`archivedAt`), with
  hard delete demoted to an explicit destructive action.

### API contract

All under `/api/v1/braindump`, JWT-guarded, schemas in
`packages/contracts/src/schemas/braindump.ts` (shared FE/BE, parsed on both sides):

- `GET /` → `{ items: BraindumpNote[] }` (newest first, ≤200)
- `POST /` `{ content: string (trimmed, 1–20 000 chars) }` → `BraindumpNote` (201)
- `PATCH /:id` `{ content }` → `BraindumpNote`; 404 if not the caller's
- `DELETE /:id` → 204; planned: `PATCH /:id` gains `archived` once soft archive lands

Wire `BraindumpNote` is `{ id, content, createdAt, updatedAt }` (ISO strings, Mongo
`_id` mapped to `id`) — the client never sees Mongo types or extra stored fields.

### Accessibility

(NFR-11: keyboard-navigable, WCAG 2.1 AA, reduced motion.)

- Capture input has a visually-hidden `<label>` ("Dump a thought"); the placeholder is
  flavor, not the accessible name. A visually-hidden submit button keeps Enter-to-add
  reliable and exposes the action to assistive tech.
- Notes render as a `<ul>` of `<li>` (list semantics announce count); timestamps are
  `<time dateTime={iso}>` so the machine-readable instant backs the casual label.
- On successful capture, a polite `aria-live` status region announces "Thought captured"
  — _gap: not yet implemented_; today only errors are announced (`role="alert"` on save
  and load failures, which stays).
- Delete/archive buttons carry content-derived labels (`Delete note: <first 40 chars>`)
  and are keyboard-reachable. Target focus management: after deleting, focus moves to the
  next note's action (or the capture input when the list empties) so keyboard users are
  never dropped to `<body>` — _gap: not yet handled_.
- Visible focus ring on input, notes' actions, and the hidden submit when focused (it
  must become visible on focus); optimistic "saving" affordances use opacity _plus_ a
  visually-hidden "Saving…" text on the pending row (dimming alone is invisible to
  screen readers and fails the not-color/style-alone rule), and any entry animation is
  disabled under `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton rows shaped like notes (line + timestamp), inside the widget's own
  suspense boundary. _Gap:_ currently a plain "Loading notes…" `role="status"` text.
- **Empty:** inviting first-capture copy ("Empty head, full heart. Dump your first thought
  above.") — an invitation, not a blank pane; input stays focused-ready.
- **Error/degraded:** Mongo down means _this widget_ shows its error card ("Couldn't load
  braindump notes" + retry) while the rest of the dashboard renders normally — exactly
  the ARD §2 failure-posture row for Atlas. Render crashes are caught by the per-widget
  error boundary (§4.2); the shell never blanks.
- **Optimistic behavior:** capture per Frontend above; delete/archive is also optimistic
  (row removed immediately, restored with an alert on failure). Mutations invalidate the
  `['braindump']` query so the list reconciles with the server.
- **i18n (NFR-12):** all copy (label, placeholder, empty/error strings, announcements)
  externalized to the shared strings layer; relative timestamps ("2 minutes ago",
  "yesterday, 21:14") produced via `Intl.RelativeTimeFormat` / locale-aware date
  formatting keyed off the active locale. _Gap:_ strings and the `formatTimestamp`
  helper are currently hardcoded English (though date/time parts already use
  `toLocale*String`).

## Consequences

- Capture is trustworthy: the "text lives in exactly one place until persisted or
  abandoned" invariant makes the widget safe to rely on mid-thought, which is the whole
  product. It costs a small state machine (draft → pending row → saved/failed) that must
  be tested, including the failure paths.
- ADR-003 is validated end-to-end: repository base class, userId scoping, Mongo-behind-API,
  contract-mapped wire shape. Every future Mongo module (journal, content) copies this
  template instead of re-deciding it.
- Schema flexibility is bought cheaply: `archivedAt` / `promotedTaskId` land without
  migrations, but the contract layer must keep masking stored fields the client shouldn't
  see — the zod schemas are now the real API surface and must stay strict.
- Client-side promote composition keeps modules decoupled but is non-atomic (task created,
  archive fails → note lingers). Acceptable for v1 single-user; the event-bus path is the
  documented escalation, so no one reaches for a cross-module import.
- The recorded gaps (optimistic capture, aria-live announcement, delete focus management,
  skeleton, soft archive, i18n extraction) are now explicit debt with a defined target
  rather than silent divergence.

## Alternatives considered

- **Postgres row per note (JSONB or text column):** simpler ops, one database — but
  Phase 1 exists to validate the Mongo path early (§9), notes are the canonical
  document-shaped data in §4.3, and rejecting the split here would unwind ADR-003 for
  no relational gain (no joins, aggregations, or RLS-dependent realtime on notes).
- **Server-ack capture (keep text in the input until 201):** never loses text and is
  trivially simple — it is the current implementation — but it serializes rapid capture
  behind network latency, breaking the zero-friction promise. Rejected as the end state;
  kept only as the stepping stone.
- **Persistent offline queue (localStorage/IndexedDB outbox):** stronger durability, but
  it is offline-first sync by the back door — an explicit non-goal (§1.3) — and brings
  reconciliation and multi-tab complexity a personal dashboard doesn't need.
- **Server-side promote endpoint calling TasksService:** atomic, one round trip — but it
  requires either a direct cross-module import (forbidden, §4.1) or standing up saga
  machinery for a two-step personal-app flow. The event bus remains available if
  atomicity ever matters.
- **Realtime list via Supabase Realtime:** not possible without moving the data to
  Postgres (realtime is a Supabase feature), and a single-user capture widget gets no
  value from live sync; query invalidation after mutations is sufficient.
