# ADR-038: Nutrition widget (food log, personal food library, calorie tracking)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Review:** claude-reviewed, PO-reviewed

## Context

This ADR exists because of a product-owner request at the ADR-029 review: fast calorie tracking, built around the reality that most days repeat a known set of foods ("foods I always eat") while some meals have unknown calories — and that **tracking the eating event matters more than knowing its number**. "Tracking is the first step" is the design brief.

Forces:

- **Capture speed is the product.** The braindump/appreciation lesson applies with full force: a food log that takes more than a couple of taps per meal stops being used within a week. The common case — logging a food eaten many times before — must be one tap.
- **Unknown values must not block logging.** A meal whose calories the user doesn't know is still a meal that happened. Requiring a number at capture time either blocks the log or teaches the user to invent numbers; both corrupt the dataset the widget exists to build. Nullable `kcal` is therefore load-bearing, not a convenience.
- **Eating data is health data.** It joins the §5.3 highest-value tier alongside journal, mood, and fitness (ADR-029) — and it carries a sharper edge: eating-pattern data is disordered-eating-adjacent, so the no-shaming posture (ADR-014/027/029) applies with extra force. This widget reports, it never judges.
- **One module per concern.** Calorie tracking is not a fitness feature: a food library plus eating events is a different data shape, UX flow, and failure domain than workout rows and metric series — the same boundary argument that kept appreciation out of journal (ADR-017) and work tracking out of appreciation (ADR-023). ADR-029 cross-references this ADR as the nutrition home.
- **No external food database in v1** (NFR-8, and the ADR-032 content-sourcing posture): licensing, data quality, and lookup UX for a public food DB dwarf the actual need — a personal diet is a small, stable vocabulary the user knows better than any database.

## Decision

### Scope

v1 is: a **personal food library** (name + optional kcal per serving), a **food entry log** (what, when, how much, kcal nullable), and **honest daily totals**. Nothing else: no barcode scanning, no public food database, no macros (kcal only), no meal planning. A future energy-balance view (intake vs. the watch's activity calories) becomes a single-database SQL query once ADR-029's committed Withings ADR lands — designed toward, not built.

### Frontend

`apps/web/widgets/nutrition/` (`id: "nutrition"`, sizes 2×2 / 4×2), standard SDK widget (§4.2), plus a `/nutrition` route (the ADR-016/020/029 widget-vs-destination split) for history browsing, backfilling, and library management.

- **Card:** today's total ("1 480 kcal · 2 uncounted"), the quick-add input, and `frequentCount` one-tap chips of the most-frequently-logged foods ("Oatmeal", "Rye bread + egg") — tapping a chip logs one serving immediately. The input is a typeahead over the library; free text that matches nothing becomes a free-form entry (kcal unknown) on Enter.
- **"Add detail" disclosure** expands quantity, kcal override, time, meal label (prefilled from the clock — see Data model), and note — the ADR-023 pattern: creatable in seconds, improvable later.
- `settingsSchema` (zod): `{ frequentCount: 4–8 (default 6), showKcalTotal: boolean (default true), dailyTargetKcal: number|null (default null — opt-in, rendered neutrally, never as deficit) }`.
- Generated hooks (`packages/contracts`), optimistic add with the shared undo pattern (ADR-008); on failure the typed text is restored into the input (ADR-010's loss-proof rule).

### Backend

`NutritionModule` (`apps/api/src/nutrition/`: controller → service → repository), importing no other domain module. Logging emits `nutrition.entry_logged { userId, entryId, localDate }`; streaks (one `EVENT_TO_STREAK` entry) and automations subscribe (§4.1). Daily totals are **SQL server-side** in the home timezone (`local_date` uses ADR-014's boundary) — ADR-029's no-client-bucketing rule, inherited.

### Data model

Postgres, owned solely by `NutritionModule`, RLS `user_id = auth.uid()`:

```sql
foods (                                        -- the personal library
  id               uuid PK default gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users,
  name             text NOT NULL CHECK (char_length(name) between 1 and 100),
  kcal_per_serving numeric CHECK (kcal_per_serving between 0 and 5000),  -- nullable: "I eat it, no idea"
  serving          text,                       -- "1 bowl", "100 g" — display copy, not math
  archived         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lower(name))
);

food_entries (                                 -- the log; entries SNAPSHOT the food
  id         uuid PK default gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users,
  food_id    uuid REFERENCES foods ON DELETE SET NULL,   -- provenance only
  name       text NOT NULL,                    -- copied at log time
  kcal       numeric CHECK (kcal between 0 and 10000),   -- entry total; NULL = unknown, a first-class state
  qty        numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  eaten_at   timestamptz NOT NULL DEFAULT now(),
  meal       text CHECK (meal in ('breakfast','lunch','dinner','snack')),  -- optional; inferred at capture
  local_date date NOT NULL,
  note       text CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- indexes: (user_id, local_date desc) on food_entries; (user_id, archived, name) on foods
```

- **Entries snapshot, never join.** `name` and `kcal` are copied from the library at log time (`kcal_per_serving × qty`); `food_id` is provenance, not truth. Editing a library food applies **forward only** — history and past totals never silently rewrite, the same trend-honesty instinct as mood's immutable events (ADR-009).
- **`kcal NULL` means unknown, and unknown is not an error.** Daily totals are reported as the sum of known values plus an uncounted count ("1 480 kcal · 2 uncounted"), never a fake-precise number. Backfill is a PATCH when the user learns the value.
- **The library is the user's own vocabulary** — no global food table, no shared rows. `UNIQUE (user_id, lower(name))` keeps typeahead results clean; deleting a referenced food nulls provenance but touches no entry.
- **`meal` is an optional label with an inferred default** (_PO-review:_ resolved open question 1): capture infers it from the local clock (morning → breakfast, midday → lunch, evening → dinner, otherwise snack — the exact boundaries are a client constant, not schema), one tap to change, never required. Chips and quick-add log with the inferred value and zero extra interaction; the column stays nullable so nothing downstream may assume it.

### API contract

Under `/api/v1/nutrition`, JWT-guarded, zod `.strict()` writes (§5.2), `user_id` from the token:

- `GET /foods?q=&includeArchived=` — typeahead source; `POST /foods`; `PATCH /foods/:id` (forward-only, see above); `DELETE /foods/:id` — hard delete for typos, `archived` for retired foods that keep their history.
- `GET /foods/frequent?limit=` — most-logged foods over the last 60 days, SQL-computed (drives the chips).
- `POST /entries` `{ foodId? | name, qty?, kcal?, eatenAt?, meal?, note? }` → 201. A `foodId` entry copies the library values; a `name` entry is free-form with `kcal` optional. One of `foodId`/`name` required, nothing else.
- `PATCH /entries/:id` — backfill kcal, fix qty/time/meal (this module has a PATCH: entries are correctable records, the ADR-023 posture, not immutable events).
- `DELETE /entries/:id` → 204, undo by re-POST (ADR-017 precedent).
- `GET /entries?from&to` (max span 366 days); `GET /summary?date=` → `{ totalKcal, knownCount, unknownCount, byMeal, entries }` — SQL-aggregated; `byMeal` groups the day's totals for the `/nutrition` day view (unlabelled entries group as their own bucket, honestly, not guessed into one).
- `GET /export` — full JSON dump (NFR-7).

Error semantics: 400 shape violations, uniform 404s, opaque 500s — the house rules (ADR-023).

### Accessibility

- The quick-add is a **combobox** (ARIA combobox pattern: `role="combobox"`, listbox popup, `aria-activedescendant`, results count announced politely) — the first real typeahead in the system, so this becomes the house combobox reference the way ADR-009 is the chart reference.
- Chips are real `<button>`s labelled with their action ("Log: Oatmeal, 320 kilocalories"), never bare text pills.
- Unknown-kcal entries are marked **with text** ("calories unknown"), not styling alone (WCAG 1.4.1); totals are text, announced via the shared `role="status"` line on mutations.
- Focus follows the ADR-017 delete/undo rules; all copy via the message catalog; numbers via `Intl.NumberFormat` (NFR-12); contrast AA both themes.

### UX states & privacy

- **Empty:** "What did you eat today? Log it — calories can come later." One line, then out of the way.
- **Unknown is quiet:** the "2 uncounted" affordance opens backfill for anyone who wants it; the widget never nags to fill numbers in.
- **No shaming — extra force here (§5.3 + disordered-eating adjacency):** no red over-target styling ever; `dailyTargetKcal` is opt-in and rendered as neutral progress, never deficit; no streak pressure on eating; the daily total can be hidden entirely (`showKcalTotal: false`) while logging keeps working.
- **Privacy hard rules** (highest-value tier, same standing as mood/journal/fitness): no analytics on nutrition routes; push/automation bodies are generic ("Log lunch?"), never contents or totals; server logs carry ids and error codes only — never food names, notes, or kcal values; export is user-initiated only.

## Consequences

- **Ships as:** one migration (two tables + RLS), one module, one contracts schema set, one widget folder + one route. ADR-029 is untouched — the boundary held.
- **Tracking-first works by construction:** no state of knowledge can block a log entry, which is the PO's framing made structural.
- **Snapshot semantics** mean library edits never rewrite history; the cost is that a wrongly-entered library kcal must be backfilled per entry (accepted — PATCH exists and the error is visible, not silent).
- **Committed to:** kcal-only v1 (macros are additive nullable columns later, a cheap migration); no external food DB (revisit only as an optional import-into-library, never a lookup dependency); the no-shaming rules as permanent constraints, matching ADR-029.
- The future energy-balance view (intake kcal vs. Withings activity kcal) is one Postgres query across two modules' APIs — composed in a read model, no module import (§4.1).
- **Open questions for the product owner:** (1) Meal grouping (breakfast/lunch/dinner labels on entries) — useful structure or ceremony that slows capture? -> _PO-review:_ optional label with an inferred default — the clock fills it, one tap changes it, nothing requires it (see Data model). (2) Should `dailyTargetKcal` exist at all in v1, or wait until tracking is a habit? -> _PO-review:_ ships in v1, opt-in (default null); when set it renders as neutral progress, never deficit — as drafted.

## Alternatives considered

- **Fold into `FitnessModule`/the fitness widget (ADR-029).** Rejected: different data shape (library + correctable events vs. metric series + workout rows), different capture UX, different failure domain; the one-owner rule and the ADR-017/023 precedent both say sibling module. ADR-029 records the same boundary from its side.
- **Public food database (Open Food Facts, USDA) in v1.** Rejected: licensing, data quality, and search UX are a project bigger than the widget; the user's diet is a small stable vocabulary ("foods I always eat") that a personal library captures better. Revisit only as optional import.
- **Barcode scanning.** Rejected: camera-native territory against the §1.3 no-native-app posture, and it optimizes the rare case (novel packaged food) over the common one (the usual bowl of oatmeal).
- **Require kcal on every entry.** Rejected — it blocks the habit at the exact moment it forms and teaches number-inventing; "tracking is the first step" is the design brief, and nullable kcal is its implementation.
- **Macros (protein/carbs/fat) in v1.** Rejected as scope: kcal answers the current question; macro columns are additive later without model change.
- **Join entries to foods for kcal (no snapshot).** Rejected: editing a library food would silently rewrite every past day's total — the classic trend-corruption bug; snapshots keep history honest.
- **MongoDB.** Rejected by §4.3: uniform rows queried with daily aggregations are the Postgres column of the split, and health-tier data gets RLS as the second net (the ADR-029 argument, verbatim).
