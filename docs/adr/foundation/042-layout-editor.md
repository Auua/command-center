# ADR-042: Dashboard layout editor — ordered placements, packed grid, edit mode

- **Status:** accepted (2026-11-15)
- **Date:** 2026-11-15 (accepted the same day by the product owner — the arrangement model chosen
  from three presented options, every other decision as drafted; built as Phase 4A)
- **Review:** claude-reviewed, PO-reviewed — accepted 2026-11-15
- **Depends on:** `docs/ADR.md` §4.2 (widget SDK: registry, declared sizes, settings panel,
  `instanceKey`), NFR-11 (keyboard), NFR-12 (externalized copy). Amends §4.2's layout paragraph
  on acceptance. No API or schema change.

## Context

`docs/ADR.md` §9 puts "layout customization UI" in Phase 4. The shell has rendered from a
persisted layout since Phase 0 (`widget_layouts`, `GET`/`PUT /api/v1/layout`), but nothing in the
app can change that layout. Facts as of 2026-11-15:

| Fact                  | Value                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered widgets    | 9; every one declares 1–3 `sizes` (clock: one; the rest: two or three)                                                                          |
| Grid                  | 6 columns on a page capped at 1240 px, rows `minmax(150px, auto)`; each placement carries explicit `gridPos { x, y, w, h }`                     |
| Narrow screens        | one column, in **array order** — `x`/`y` are ignored below 720 px                                                                               |
| Writers of the layout | one: the settings panel, which `PUT`s the whole list with one item's settings changed                                                           |
| Empty layout          | `GET /layout` answers `{ items: [] }` both for "never saved" and "saved empty"; the client then renders `DEFAULT_LAYOUT`                        |
| New widgets           | reach nobody with a saved layout: `japanese-kanji` (2026-11-14) is registered but in no stored layout, and is missing from `DEFAULT_LAYOUT` too |
| Uniqueness            | `UNIQUE (user_id, widget_id, instance_key)`; `instanceKey` is `''` everywhere — no multi-instance widget exists yet                             |

Forces: the dashboard is used on a phone as an installed PWA as often as on a desktop; NFR-11
requires everything to work from the keyboard; the project has added no UI dependency beyond
TanStack Query so far; and a layout is edited rarely — when a widget ships, or when habits
change — so the editor has to be obvious more than it has to be fast.

## Decision

### The order is the layout

A layout is an **ordered list of placements**. The position of each card is derived from that
order by a pure function, `packLayout(items, columns)` in `@command-center/ui`:

- placements are taken in list order; each goes to the first cell, scanning rows top to bottom
  and columns left to right, **at or after the previous placement's cell**, where its `w × h`
  footprint fits;
- the scan never goes back to fill an earlier hole (the behaviour of CSS grid's default
  row auto-flow, not `dense`), so reading order, focus order and list order are always the same.

The packed `x`/`y` are written into `gridPos` and persisted, so the contract
(`WidgetLayoutItemSchema`), the table and the read path are unchanged: `gridPos` keeps its four
numbers, of which `x`/`y` are now derived and `w`/`h` are the user's choice. `items` are stored in
the user's order, which is also the order narrow screens already render.

A layout written before this ADR (hand-placed coordinates) is read into order by sorting on
`(y, x)`. Packing never moves a card back in reading order, so sorting a packed layout by
`(y, x)` gives back its list order at any column count.
→ _PO-review (2026-11-15):_ "ordered, with move buttons" chosen over "ordered, plus
drag-and-drop" and "free placement on the grid".

### Columns follow the width

The number of columns is not fixed. `columnsForWidth(width, gap)` gives as many columns as keep
each at least **160 px** wide, **rounded down to an even number** and clamped to **4–12**; the
dashboard measures its grid (a `ResizeObserver`) and packs the ordered list at that count every
time it renders. A wide screen therefore shows more cards per row instead of wide margins, a
small laptop fewer, and the order is the same on all of them. Below 720 px the single-column
phone layout is unchanged.

- **Even counts:** almost every declared width is 2 or 4, so an odd count leaves a one-column
  strip empty at the end of most rows.
- **4 at least:** the widest declared size is 4, so above the phone layout no card is ever
  narrowed.
- **12 at most,** with the page capped at 2400 px: beyond that, columns widen rather than
  multiply.
- **What is stored:** the list in the user's order, packed at the reference width of **6**
  (`GRID_COLUMNS`) — the same on every device, whatever screen saved it. The stored `x`/`y`
  are never used to place a card; only their order is.

→ _PO-review (2026-11-15), after seeing the built editor:_ "increase the columns, use dynamic —
now it feels that sides have too much space, 6 seems too low". The page's 1240 px width cap
went with it.

### Edit mode in the shell

A toolbar above the grid carries one button, **Edit layout**. In edit mode:

- every card shows a small editor bar: **move earlier**, **move later**, a **size** select
  listing the widget's declared `sizes` (hidden when it declares one), and **remove**;
- the widget body stays visible at its real footprint but is `inert` — the editor arranges
  cards, it does not operate them;
- the toolbar shows **Add widget**, **Reset to default**, **Cancel** and **Done**;
- every change re-packs the draft immediately, and is announced through the polite live region
  ("Tasks moved to position 3 of 9"); focus stays on the control that was used;
- **Done** writes the draft with one `PUT /layout`; **Cancel** discards it. Nothing is saved
  per step. → _PO-review (2026-11-15):_ confirmed, with the last-widget rule and one placement
  per widget below.

**Add widget** opens a native `<dialog>` listing the registry definitions that have no placement,
each with its icon and title. Choosing one appends it to the end of the order with its first
declared size and its `defaultSettings`.

Moves are by buttons only in v1. Drag-and-drop is a later addition on the same model (it would
call the same "move to index" operation), not a different design.

### Rules at the edges

- **One placement per widget in v1.** The picker offers only unplaced definitions and
  `instanceKey` stays `''`. Multi-instance placement (ADR-013's per-track lessons) arrives with
  its first consumer, as a flag on the definition.
- **Removing a widget drops its settings.** The placement row holds them; `PUT` replaces the
  list. Re-adding starts from `defaultSettings`. No "hidden" state is introduced.
  → _PO-review (2026-11-15):_ confirmed — "keep the settings of a removed widget" was offered
  and not taken.
- **The last widget cannot be removed.** An empty saved layout cannot be told apart from "never
  saved" and would bounce back to the default on the next load; refusing the last removal keeps
  the stored layout honest without a schema change. **Reset to default** is the explicit way
  back to `DEFAULT_LAYOUT`.
- **`DEFAULT_LAYOUT` becomes an ordered list** covering every registered widget (it gains
  `japanese-kanji`), its coordinates produced by `packLayout`.
- **A size is only ever one of the declared ones.** The select is the write side;
  `clampToDeclaredSize` stays as the read-side guard.
- **Unknown stored widgets** (an id no longer registered) keep rendering the existing "unknown
  widget" card and can be removed in the editor like any other.

### API

None. `PUT /layout` already replaces the whole list and validates uniqueness; the server keeps
storing `gridPos` as given and stays unaware of the registry (ADR §4.2: the registry is
client-side).

## Consequences

- **Easier:** adding, removing, resizing and reordering are possible from the app, with the same
  result on phone and desktop; a newly shipped widget is one "Add widget" away for everyone; the
  editor is fully keyboard-usable because it is made of buttons and a select.
- **Easier:** the layout logic is a pure, unit-tested function shared by the editor preview, the
  default layout and the save path.
- **Harder / accepted:** no deliberate gaps and no pixel-exact arrangement — a card sits where
  the order puts it. A row can end with a hole when the next card does not fit; the fix is to
  reorder or resize.
- **Harder / accepted:** a layout hand-placed before this ADR re-flows the first time it is
  shown: cards keep their reading order but lose deliberate gaps.
- **Harder / accepted:** a layout cannot be gap-free at every width. Rows of 2- and 4-wide
  cards end flush at any even count, but a 3-wide card (grammar) leaves gaps at some widths;
  the default layout is gap-free at 6 and 12 columns and has a few empty cells at 4, 8 and 10.
- **Harder / accepted:** settings of a removed widget are gone; there is no undo after **Done**
  (Cancel covers everything before it).
- **Committed to:** `gridPos.x`/`y` being derived data. A future free-placement mode would have
  to reintroduce them as user data and supersede this ADR.
- **Docs owed on acceptance:** `docs/ADR.md` §4.2 (layout paragraph), §7 row 042, §9;
  `docs/adr/README.md` index; `docs/adr/REVIEW-QUEUE.md`; CLAUDE.md Current State; README
  widget-system paragraph; `docs/plans/phase4-reflection.md` step 4A.

## Alternatives considered

- **Free placement on the grid** (drag to any cell, gaps allowed, corner resize): the classic
  dashboard builder. Rejected for v1 — it needs a grid-drag library (the first UI dependency of
  its kind), is weakest exactly where the app is used most (touch) and where NFR-11 is strictest
  (keyboard), and needs a second, separate order for narrow screens.
- **Ordered model with drag-and-drop in v1:** same data model, more pointer and touch code to
  write and test for an action taken a few times a year. Deferred, not rejected.
- **Dense packing** (later cards back-fill earlier holes): tighter, but the visual order stops
  matching the list order, so "move earlier" moves a card somewhere unexpected and focus order
  diverges from reading order.
- **Let CSS auto-placement do the packing and stop storing `x`/`y`:** fewer lines, but the
  packed result would exist only in the browser's layout engine — not testable, not available to
  the default layout or to any future server-side consumer, and a contract change for no gain.
- **Saving every change immediately:** no Done/Cancel, but every step is a whole-list `PUT` and a
  half-finished rearrangement is live on the other device at once. One write per edit session is
  simpler to reason about and gives Cancel for free.
- **A separate settings page for the layout:** the list would be edited away from the thing it
  arranges; edit mode on the dashboard shows the result while it is being made.
- **A `hidden` flag instead of removal** (to keep a removed widget's settings): a second state
  for every consumer of the layout to handle, for settings that are a handful of toggles.
