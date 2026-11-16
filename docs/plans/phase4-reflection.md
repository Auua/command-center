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
| 4A ✓ | `phase4-layout-ui`    | Layout editor: `packLayout`, edit mode (move / size / remove), Add-widget picker, reset. No API change.           | ADR-042                           |
| 4B ✓ | `phase4-appreciation` | `AppreciationModule` (Postgres, migration 0012), server-served daily prompt, `appreciation` widget.               | 4A, ADR-017                       |
| 4C   | `phase4-journal`      | `JournalModule` (Mongo), TipTap editor on a `/journal` route, local-first drafts, `journal` widget.               | 4A, ADR-016                       |
| 4D ✓ | `phase4-calendar`     | `CalendarModule`: own events, server-expanded RRULE, shared recurrence utility, `/calendar` route, agenda widget. | 4A, ADR-018                       |
| 4E   | `phase4-recurrence`   | Recurring tasks on the shared recurrence utility; public holidays in the calendar.                                | 4D, ADR-036, ADR-033 (+amendment) |
| 4F   | `phase4-gcal`         | Google Calendar sync: OAuth custody, per-calendar mode, mirror over a rolling horizon.                            | 4D, ADR-037 (+amendment)          |
| 4G   | `phase4-export`       | Per-module JSON export (NFR-7).                                                                                   | 4B–4D                             |

4B and 4C are independent of each other; 4B is the smaller and goes first so the reflection
column of the dashboard exists before the journal's larger build. Each later step gets its own
section here when it starts — only 4A is detailed now.

## 4D — Calendar (ADR-018) ✓ (day/week views: 4D-2)

Built 2026-11-16, split like 4C:

- **4D (this PR) — events and the two list-shaped views.** `CalendarModule` (Postgres
  `calendar_events`, migration 0013), recurrence expansion on the server (`calendar/expansion.ts`,
  rrule 2.8.1 + luxon; the DST suite in `expansion.spec.ts`), the `calendar` card (agenda: today
  at 2×2, the rolling week at 4×2), `/calendar` with Agenda and Month (roving-tabindex grid, day
  panel), the event dialog with a Repeat form, delete with undo ("only this one / the whole
  series"), the task-deadline overlay, and a Calendar link in the header.
- **4D-2 — Day and Week.** The hour-track views (all-day strip on top, chronological DOM order),
  then `defaultView` gains `day | week`.

The shared recurrence utility named for 4E is the API's `calendar/expansion.ts` (pure, takes any
row with a start and an RRULE); 4E extends it to task rows. Decisions settled in the build are in
ADR-018's implementation note (series timezone, text exdates, date ranges, saves not optimistic).

## 4C — Journal (ADR-016) ✓ (search: 4C-2 ✓)

Built 2026-11-16. The largest Phase 4 step; split in two PRs so each stays reviewable:

- **4C (this PR) — write and keep.** `JournalModule` (Mongo `journal_entries` + seeded
  `journal_prompts`), the editor routes, local-first drafts, the timeline (date range + tag
  filters), export, the `journal` launcher widget and a `journal` streak.
- **4C-2 — search.** `GET /journal/search` over an Atlas Search index. Separate because
  `$search` cannot run on mongodb-memory-server, so it needs its own test seam. Built
  2026-11-16: the API creates the index itself (no manual Atlas step after all), results are
  newest first with the timeline's cursor and highlighted passages, and the endpoint answers 503
  until the index is queryable. Details in ADR-016's second implementation note.

### Decisions settled in the build (recorded in ADR-016's implementation note)

- **One read for the launcher:** `GET /journal/today?locale=&categories=` returns the home-timezone
  date, the day's prompt and today's latest entry preview — it subsumes the ADR's
  `/prompts/today`, so the card makes one request.
- **No title field** — the data model has none; a heading inside the doc is the title. Focus lands
  in the content area.
- **Server-derived text without TipTap on the server:** `plainText` / `textPreview` / `wordCount`
  and the export's Markdown come from a small pure walker over the validated tree in
  `packages/contracts` (`journal-doc.ts`) — the vocabulary is 10 nodes and 5 marks, so the API
  takes no editor dependency.
- **Exact attrs:** TipTap 3 (pinned 3.32.2) emits `link {href,target,rel,class,title}`,
  `orderedList {start,type}`, `heading {level}`; the contract allows exactly those. A web test
  runs the real editor's `getJSON()` through the contract so an editor upgrade that adds an attr
  fails CI instead of failing saves.
- **Idempotent retry:** a `PATCH` whose `baseVersion` is one behind and whose doc and tags equal
  the stored ones returns the stored entry (200), so a retried timeout is never a false 409.
- **Body limit:** the API's JSON body limit rises from Express's 100 kB to 320 kB (doc cap 256 kB).
- **Prompts seed on boot:** `journal_prompts` is upserted with `$setOnInsert` on module init —
  idempotent, never overwrites a prompt edited in Atlas.
- **Streak:** `journal.entry_created` (on create) → streak key `journal` (ADR-014 names it).

### Pieces

- Contracts `schemas/journal.ts` (doc allowlist, entries, list/cursor, today, export, event) and
  `journal-doc.ts` (text, preview, word count, Markdown).
- API `apps/api/src/journal/`: repository (user-scoped; indexes `userId+entryDate+_id`,
  `userId+tags`), service (create / patch with version check / delete / list / get / today /
  export), prompts repository + seed, controller.
- Web: `app/journal/` (layout with back link, timeline page, `new` and `[entryId]` editor pages
  loading the editor via `next/dynamic`), `components/journal/` (editor, toolbar with roving
  tabindex, save status, delete dialog), `lib/journal-drafts.ts` (IndexedDB draft store behind an
  interface), `lib/journal-autosave.ts` (the save engine: 2 s debounce, 10 s max, flush on blur /
  hide / leave, 409 handling, backoff while offline), `lib/journal-api.ts`, `widgets/journal/`.

## 4B — Appreciation (ADR-017) ✓

Built 2026-11-15. Migration `0012_appreciation.sql` (entries + seeded prompts), `AppreciationModule`
(list / create / delete / export / prompt of the day), contracts `schemas/appreciation.ts`, widget
`widgets/appreciation/`. Details settled in the build are recorded as an implementation note in
ADR-017. One-time setup (the migration) is `docs/PHASE4_SETUP.md`.

## 4A — Layout editor (ADR-042) ✓

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

**Added after the first review (2026-11-15, PO):** the column count follows the width —
`columnsForWidth` (columns ≥ 160 px, even, 4–12) + a `ResizeObserver` hook; the page width cap
goes from 1240 px to 2400 px. Rendering always packs the ordered list at the measured count;
saves stay packed at the reference 6.

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
