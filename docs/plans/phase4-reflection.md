# Phase 4 plan — Reflection & polish

_Written 2026-11-15, after Phase 3 (3A–3E) landed. Scope per `docs/ADR.md` §9: Journal,
Appreciation, Calendar views, Google Calendar sync, layout customization UI, data export._

## Scope and order

Three facts shape the order:

- **The layout editor had no design.** §9 names it, no ADR covered it. ADR-042 (drafted with this
  plan) is that design, and it goes first: nine widgets exist, none can be added, removed or
  moved from the app, and every widget this phase adds needs a way onto an existing dashboard.
- **There is no worker.** ADR-039 deferred pg-boss and the worker; the only scheduled execution
  is the inline tick behind the external pinger. ADR-033 (holidays, "worker-prefetched") and
  ADR-037 (Google Calendar, "worker-polled every 10 min") were written against the worker. Each
  needs a delivery amendment — tick-driven or on-demand — before its step starts. Flagged here,
  decided there.
- **Data export has no ADR either.** NFR-7 asks for "a JSON dump endpoint per module". Small
  enough to decide at its own step; listed last because it should cover the modules this phase
  adds.

Delivery is one PR per step, each leaving `main` deployable:

| Step | PR                    | Ships                                                                                                             | Depends on                        |
| ---- | --------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 4A   | `phase4-layout-ui`    | Layout editor: `packLayout`, edit mode (move / size / remove), Add-widget picker, reset. No API change.           | ADR-042                           |
| 4B   | `phase4-appreciation` | `AppreciationModule` (Postgres, migration 0012), server-served daily prompt, `appreciation` widget.               | 4A, ADR-017                       |
| 4C   | `phase4-journal`      | `JournalModule` (Mongo), TipTap editor on a `/journal` route, local-first drafts, `journal` widget.               | 4A, ADR-016                       |
| 4D   | `phase4-calendar`     | `CalendarModule`: own events, server-expanded RRULE, shared recurrence utility, `/calendar` route, agenda widget. | 4A, ADR-018                       |
| 4E   | `phase4-recurrence`   | Recurring tasks on the shared recurrence utility; public holidays in the calendar.                                | 4D, ADR-036, ADR-033 (+amendment) |
| 4F   | `phase4-gcal`         | Google Calendar sync: OAuth custody, per-calendar mode, mirror over a rolling horizon.                            | 4D, ADR-037 (+amendment)          |
| 4G   | `phase4-export`       | Per-module JSON export (NFR-7).                                                                                   | 4B–4D                             |

4B and 4C are independent of each other; 4B is the smaller and goes first so the reflection
column of the dashboard exists before the journal's larger build. Each later step gets its own
section here when it starts — only 4A is detailed now.

## 4A — Layout editor (ADR-042)

No backend work: `PUT /layout` already replaces the whole list.

### `@command-center/ui`

- `layout-pack.ts`, pure and dependency-free:
  - `GRID_COLUMNS = 6`;
  - `packLayout(items, columns)` — order-preserving first-fit (never back-fills), returns the
    items with `gridPos.x`/`y` set; a footprint wider than the grid is clamped to it;
  - `orderOfLayout(items)` — stable sort by `(y, x)`, the reading order of a stored layout;
  - `moveItem(items, from, to)` — the one reorder primitive; every editor action is a list
    operation followed by `packLayout`.
- Exported from the package index next to `clampToDeclaredSize`.

### Web

- `components/dashboard-grid.tsx` keeps rendering; the edit state lives in a new
  `components/layout-editor.tsx` hook/component pair:
  - `useLayoutDraft(items)` — draft list, `move`, `resize`, `remove`, `add`, `reset`, `dirty`;
  - `LayoutToolbar` — Edit layout / Add widget / Reset to default / Cancel / Done;
  - `LayoutItemBar` — move earlier, move later, size select, remove, per card;
  - `AddWidgetDialog` — native `<dialog>`, unplaced registry definitions.
- `WidgetCard` (ui) gains nothing: the bar renders in the grid cell above the card, and the card
  is wrapped `inert` while editing.
- `widgets/default-layout.ts` becomes an ordered list of every registered widget, packed.
- Copy under `layout.*` in the i18n catalog; announcements through `useAnnouncer`.
- Styles in `globals.css` using the shared button/chip primitives — no per-widget CSS.

### Tests

- `packLayout`: mixed sizes, a card that does not fit the row, no back-fill, clamp to grid width,
  idempotence (packing a packed layout changes nothing), `orderOfLayout` on the old default.
- Editor (vitest + Testing Library): enter edit mode, move, resize to a declared size, remove
  (last one refused), add from the picker, Cancel restores, Done sends one `PUT` with the packed
  list in order, announcements.
- Existing settings-panel tests keep passing — it still writes the whole list.

### Docs owed

ADR-042 status and review line, `docs/adr/README.md` row, REVIEW-QUEUE batch, `docs/ADR.md` §4.2

- §7 + §9, CLAUDE.md Current State, README widget-system paragraph.

## Out of scope, recorded

Drag-and-drop (later, same model — ADR-042), multi-instance placement (arrives with ADR-013's
tech lessons), free 2D placement (rejected in ADR-042), a "new widget available" nudge on the
dashboard (the picker is the discovery surface).
