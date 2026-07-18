# ADR-017: Appreciation Tracker Widget

- **Status:** Accepted
- **Date:** 2026-07-13
- **Review:** claude-reviewed, PO-reviewed

## Context

Phase 4 (ADR §9) includes the appreciation tracker: a lightweight gratitude log — one short line per entry ("Neighbour's dog said hi"), timestamped, optionally tagged. The ADR's data-ownership table (§4.3) already assigns `appreciation_entries` to **Supabase Postgres**, in contrast to journal entries, which are rich-text Mongo documents owned by `JournalModule`.

Two forces are in tension:

1. **The mock nests it.** `docs/design/dashboard-mock.html` renders "Recent appreciations" _inside_ the Journal card as a composed section below the daily prompt — visually attractive, but it puts one widget's content inside another widget's chrome.
2. **The widget SDK isolates.** §4.2 requires each widget to be self-contained: its own registry entry, error boundary, suspense boundary, `settingsSchema`, and quick actions. A section rendered inside the Journal card would share Journal's error boundary (a Journal/Mongo outage would take appreciations down with it, and vice versa), have no independent settings panel, and could not be added/removed/moved on its own — violating G4 and the "one failing endpoint = one fallback card" load model (§4.5).

The capture UX should feel like braindump (one-line input, Enter to add, optimistic append) with the tasks widget's delete-undo (ADR-008), because those interactions are already proven in daily use. Tone matters more than for other widgets: this is a gratitude practice, and cold or clinical copy undermines it. NFR-7 (privacy, exportability), NFR-11 (a11y), and NFR-12 (i18n) apply in full.

## Decision

### Widget composition

We will build appreciation as a **standalone widget and a standalone backend module** — not a section of Journal. It gets its own registry entry (`id: "appreciation"`), its own folder under `apps/web/widgets/appreciation/`, its own error and suspense boundaries, and its own `AppreciationModule` in the API. -> _PO-review:_ confirmed — standalone card, with the mock's pairing preserved through adjacency in the default layout.

We keep the mock's _visual_ intent through layout, not nesting: the widget supports a **compact size** (header + input + N recent entries, no chrome beyond the standard card), and the default grid (`apps/web/widgets/default-layout.ts`) places it directly below Journal so the pairing reads the same as the mock. The mock's composition is reinterpreted as "adjacent in the default layout", which preserves every SDK guarantee — Journal failing renders Journal's fallback card while appreciations keep working, and the user can still remove, move, or resize either independently. Nothing couples the pair: removing Journal leaves appreciation fully functional in place, which literal nesting could never offer.

### Frontend

- `apps/web/widgets/appreciation/` with a registry entry conforming to `WidgetDefinition` (§4.2): `sizes: [compact, tall]`, `settingsSchema`, `quickActions: [{ id: "add-appreciation", label: "Add appreciation" }]` which focuses the input (opening the widget's card if collapsed).
- **Settings** (zod schema, drives the auto-generated panel): `recentCount` (3–10, default 3 — matches the mock), `showDailyPrompt` (boolean, default on).
- **Daily prompt:** when `showDailyPrompt` is on and no entry exists for the local day, the input's placeholder becomes the day's prompt ("What made you smile today?"); once an entry exists it reverts to a neutral "Add an appreciation…". -> _PO-review:_ prompts are **backend-served, not frontend copy** (overturning the draft): a seeded `appreciation_prompts` reference table (see Data model) behind `GET /api/v1/appreciation/prompts/today`, picked deterministically with ADR-016's formula (`hash(userId + isoDate) mod count(active)`) — same prompt all day, stable across devices, editable without a deploy. The prompt is presentation sugar: if the fetch fails, the placeholder silently falls back to the neutral copy and capture is unaffected.
- Data access only through generated hooks in `packages/contracts` (ADR-007); no direct Supabase access. TanStack Query key `["appreciation", { limit }]`; optimistic mutations write to that cache and invalidate on settle, matching the braindump widget's pattern.
- The widget mounts inside the shell-provided error + suspense boundaries like every other widget; its skeleton is the suspense fallback, so first paint of the shell never waits on this endpoint (§4.5 load model).
- **Automation nudge:** an optional evening "any appreciations today?" reminder is _not_ implemented inside this widget. It is a normal `AutomationModule` automation (`kind: time`, notify action). If we later want "skip the nudge if an entry exists", `AppreciationModule` emits `appreciation.added` on the event bus and Automation listens — no module imports either way (§4.1 rules).

### Backend

A small dedicated **`AppreciationModule`** (`apps/api/src/appreciation/`: controller, service, repository — same shape as `braindump/` and `mood/`, same test layout: unit specs per file plus a hermetic e2e slice). No worker involvement: the widget has no scheduled behavior of its own; any nudge is Automation's job.

Not folded into a "ReflectionModule": the one-owner rule (§4.1/§4.3) means it owns its table regardless, `MoodModule` and `JournalModule` already set the precedent of one module per reflection concern, and a grab-bag module would blur exactly the boundary that makes later extraction cheap (ADR-002). The module is ~4 files; the overhead is trivial.

### Data model

Postgres table, owned solely by `AppreciationModule`:

```sql
create table appreciation_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id),
  text       text not null check (char_length(text) between 1 and 280),
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on appreciation_entries (user_id, created_at desc);
-- RLS: user_id = auth.uid() for all commands, per NFR-6
```

Tags are a `text[]` column, not a normalized join table — the same choice `tasks` and `mood_checkins` already made (§4.4). Tag queries are per-user over a personal-scale table; a GIN index can be added later without a model change.

`appreciation_prompts` (added at PO review — see Frontend): seeded reference data owned by `AppreciationModule` — `{ id, text (per-locale, NFR-12), active }`. Not user data: readable by any authenticated user, written only by seed migrations, so it carries no user-scoped RLS. The daily pick is computed, never stored.

**Why Postgres, not Mongo:** entries are short, flat, uniform rows — no rich text, no nested structure, nothing document-shaped. Expected queries are relational (recent-N per user, count-per-day for a future streak/heatmap, tag filtering), which is index-friendly SQL. Postgres adds RLS as the second authorization net (§5.1) and keeps this data in the store that already holds the adjacent mood check-ins, so a future "mood × gratitude" trend view is a single-database query. Journal is Mongo because of rich-text documents and Atlas full-text search — neither applies here.

### API contract

REST under `/api/v1`, zod schemas in `packages/contracts` (reject-unknown-fields on, per §5.2), JWT-scoped as everywhere — `user_id` always from the token, never the body:

- `GET /api/v1/appreciation?limit=N` — recent entries, newest first (default `limit` = widget's `recentCount`).
- `POST /api/v1/appreciation` — `{ text, tags? }` → created entry (server sets `id`, `created_at`).
- `DELETE /api/v1/appreciation/:id` — hard delete; undo is client-side (see below).
- `GET /api/v1/appreciation/export` — full JSON dump (NFR-7 per-module export).
- `GET /api/v1/appreciation/prompts/today` — the deterministic daily prompt, `{ id, text }` in the user's locale (added at PO review; see Frontend). Read-only reference data, cacheable for the rest of the local day.

Entry shape on the wire: `{ id, text, tags, createdAt }` (camelCase per the generated client; the contract schema is the single source shared FE/BE). `text` is validated 1–280 chars trimmed, `tags` max 5 of ≤24 chars — the same limits the DB check constraint enforces, so validation failures never reach Postgres.

No PATCH in v1: entries are one-liners; edit = delete + re-add. Revisit if dogfooding disagrees. -> _PO-review:_ confirmed. Standard per-user throttling applies (§5.2); no route-specific tightening — this is a low-risk write surface.

### Accessibility

- The input has a visible `<label>` ("Add an appreciation") — the rotating prompt lives in `placeholder`/description text, never as the only label.
- Recent entries render as `<ul>` with one `<li>` per entry, so screen readers announce list size; each entry includes a visually-hidden localized relative timestamp ("2 hours ago").
- A visually-hidden `aria-live="polite"` region confirms mutations: "Appreciation added." / "Entry deleted. Undo available."
- Each entry's delete button is keyboard-reachable, labeled "Delete: {entry text}". On delete, focus moves to the **Undo** affordance in the confirmation row; if undo expires or is dismissed, focus moves to the next entry (or the input when the list empties) — never dropped to `<body>`.
- Visible focus rings on input, entries' delete buttons, and undo (shared tokens from `packages/ui`); delete affordances may reveal on hover but are always exposed to keyboard and assistive tech (no hover-only controls).
- Entry text and timestamps meet WCAG 2.1 AA contrast in both themes, including the muted timestamp color (NFR-11).
- The add animation (new entry slides in) is disabled under `prefers-reduced-motion`: entries simply appear (NFR-11).

### UX states & interaction

- **Loading:** skeleton of the input bar + `recentCount` shimmer lines inside the standard card.
- **Empty:** warm first-use copy, e.g. "Nothing here yet — what's one small thing that went right today?" with the input front and center. No lecture about gratitude science; one inviting line. The same warmth applies after a delete empties the list ("All clear. Add one when something good happens.") — the empty state should invite, never scold about streaks or missed days.
- **Error (load):** the SDK fallback card with a retry button; the shell stays intact (§4.2 isolation).
- **Error (mutation):** inline, inside the card — a failed add or delete never escalates to the whole-widget fallback, because the last-known-good list is still valid.
- **Add:** Enter (or the quick action) optimistically prepends the entry with a temporary id and clears the input, so rapid multi-add flows; on API failure the entry is rolled back, its text restored into the input (never lost), and an inline error shown. The list shows at most `recentCount` entries; older ones are reachable via a "Show more" expansion, not pagination chrome — this is a glanceable card, not an archive view.
- **Delete:** optimistic removal with a ~6 s Undo — the shared undo pattern from tasks (ADR-008; braindump has no undo, its target is soft archive); undo restores via re-`POST` since delete is hard. The undo timeout pauses while the Undo button has focus or hover (WCAG 2.2.1) — required, since delete moves focus onto it (see Accessibility).
- All copy through the i18n layer (NFR-12); timestamps formatted with `Intl.RelativeTimeFormat` in the user's locale.

## Consequences

- **Ships as:** one migration (`appreciation_entries` + RLS policies, plus the seeded `appreciation_prompts` reference table), one API module, one contracts schema pair, one widget folder + registry entry, one default-layout tweak. No changes to Journal, Mood, or the shell.
- **Easier:** independent failure domains (Journal/Mongo down ≠ appreciations down); per-widget settings and layout control for free from the SDK; trend/count/streak queries and a future mood-correlation view are plain SQL in one database; export endpoint satisfies NFR-7 mechanically; extraction path stays clean (ADR-002).
- **Harder / committed to:** one more module, migration, and widget folder to maintain for a small feature; the dashboard has two reflection cards where the mock showed one, so the default layout must be tuned so the pairing still reads as a unit; hard delete means undo depends on the client re-posting (accepted: entries are one-liners, and avoiding soft-delete keeps the table trivial); adding tags UI later must not compromise the one-line capture speed.
- Prompts as seeded reference data mean changing them is a data edit, not a deploy (_PO-review:_ chosen over the drafted frontend-copy approach). Cost: one more (tiny, cacheable) read endpoint, a seed migration, and the widget's graceful placeholder fallback when the prompt fetch fails.
- Emitting `appreciation.added` commits us to keeping that event name stable once Automation subscribes to it; it becomes part of the module's public contract alongside its REST surface.
- The ADR's data-ownership table (§4.3) needs no change — it already lists `appreciation_entries` under Postgres; this ADR gets a summary row in §7.

## Alternatives considered

- **Render inside the Journal widget (as mocked).** Rejected: violates §4.2 isolation — shared error boundary, no independent settings/quick actions, not addable/removable on its own, and it would force `JournalModule` (Mongo) to proxy or compose Postgres data it doesn't own, breaking the one-owner rule.
- **A "Reflection" super-widget composing journal + mood + appreciation.** Rejected: recreates the nesting problem at larger scale and contradicts G1/G4 ("adding a new life-area never requires touching another widget").
- **Store entries in MongoDB alongside journal.** Rejected: nothing document-shaped about a 280-char line; loses RLS and Postgres aggregation for trends; §4.3 already assigns this table to Postgres.
- **Fold the backend into `JournalModule` or a shared ReflectionModule.** Rejected: the one-owner rule makes shared modules the thing that turns extraction (ADR-002) and the ADR-003 fallback migration expensive; `MoodModule` precedent shows small modules are cheap here.
- **Store entries as a special journal-entry type.** Rejected: couples a flat, high-frequency, low-ceremony capture to the rich-text document model and its editor; querying "3 most recent one-liners" through a document store shaped for prose is the wrong tool.
- **Backend-served daily prompts (`GET /appreciation/prompt`).** The draft rejected this for v1 (prompts as static copy, no per-user state, endpoint = surface for zero benefit). -> _PO-review:_ **overturned** — backend-served prompts were chosen at review so prompt edits never require a deploy; the Decision above reflects that, and the rejected alternative is now the frontend-copy approach.
- **Soft delete (`deleted_at`) to power undo.** Rejected: undo-by-re-POST is simpler, keeps every query free of a `deleted_at is null` filter, and matches the braindump precedent; the cost (a restored entry gets a new id and `created_at` ≈ now) is immaterial for one-line gratitude notes.
