# ADR-009: Mood check-in + 7-day trend widget

- **Status:** Accepted
- **Date:** 2026-07-13
- **Review:** claude-reviewed, PO-reviewed

## Context

The mood widget is the Phase 1 "Reflection" widget (ADR §9): a 1–5 face scale to log how you feel, optional tags and a note, and a 7-day trend line. It is the first widget whose data the ADR names a **highest-value asset** (§5.3: "journal + mood data — private reflections"), so privacy decisions carry more weight here than for tasks or clock. It is also the first widget with a real chart, which forces us to settle chart accessibility patterns (NFR-11) that later widgets (streaks, finance) will copy.

Forces in play:

- The design mock (`docs/design/dashboard-mock.html`, "Mood check-in" card) shows a 5-face emoji scale as toggle buttons with `aria-pressed`, tag chips, and an SVG trend with a **hover-only** tooltip built in script. Hover-only is not keyboard- or touch-accessible and cannot ship as-is.
- ADR hard rails: all data via NestJS REST `/api/v1` with zod contracts in `packages/contracts` (ADR-004/007); `mood_checkins` lives in Postgres under RLS, owned solely by `MoodModule` (§4.3–4.4); the widget conforms to the `WidgetDefinition` SDK (§4.2).
- Ambiguity to resolve: one check-in per day or many? The mock's greeting says "mood not logged yet" (suggesting once daily) but the schema keys on `created_at` timestamps, and Phase 2 automations will prompt both morning and evening. -> _PO-review:_ 0–5 check-ins per day, cap enforced server-side (see Data model)
- The widget already exists (commit dd30da4: `apps/web/widgets/mood/`, `apps/api/src/mood/`, `packages/contracts/src/schemas/mood.ts`, `supabase/migrations/0003_mood_checkins.sql`). This ADR records the decisions it embodies and names the gaps where it falls short of the target.

## Decision

### Frontend

We will implement the widget as a self-contained folder `apps/web/widgets/mood/` conforming to the §4.2 SDK:

- **Registry:** one `WidgetDefinition` entry (`id: "mood"`, title "Mood check-in", sizes 2×2 and 3×2, amber accent) exported from `widgets/mood/index.ts`; the shell renders it from the persisted layout like any other widget.
- **Isolation:** the shell wraps the widget in its own error and suspense boundaries — a mood failure renders a fallback card, never a blank dashboard.
- **Data:** exclusively through `@command-center/contracts` types and a thin fetch layer (`apps/web/lib/mood-api.ts`) against `/api/v1/mood`. The widget never talks to Supabase or Postgres directly (ADR-004).
- **State:** server state in TanStack Query under the `['mood']` key; component state holds only the toggled tag chips and the last-logged check-in (for Undo). Both mutations invalidate the query key on success.
- **Pure core:** face metadata, local-day bucketing, and the trend series live in `trend.ts` as unit-testable functions with no React or network dependency; the chart geometry constants are lifted from the mock's 280×92 viewBox so the implementation matches the design pixel-for-pixel.
- **Settings:** `settingsSchema` (zod) exposes the tag vocabulary (default `focused / energetic / stressed / tired`, max 12), so the auto-generated settings panel customizes chips without code changes.
- **Quick actions:** none in v1 — the check-in **is** the widget body; a chrome-level "log mood" shortcut would duplicate it. The field stays available for a future "add note" action.

### Backend

We will keep `MoodModule` a standard NestJS domain module (§4.1): thin controller → service (rules) → repository (persistence), importing no other domain module.

- The repository queries Postgres through an RLS-scoped Supabase client built from the caller's own JWT **and** filters `user_id = token.sub` explicitly — RLS is the second net, per §5.1. The user id never comes from the request body.
- Rows are validated against `MoodCheckinSchema` on the way out; a row that fails the contract is a 500 (corrupt stored data), never a client-facing ZodError — those are reserved for request validation.
- Deleting a foreign or malformed id returns the same 404 as a missing one, so nothing leaks about other users' rows.
- Logging a check-in emits `mood.checkin_recorded` (`{ userId, checkinId, createdAt }`) on the in-process event bus (§4.1); ADR-014's streak service and Phase 2 automations subscribe — `MoodModule` imports neither.
- Trend windowing is server-side: the list endpoint returns only the requested `days` window (default 7, max 90) via an indexed `created_at >= since` query — the client never pulls full history.

**Gap vs target:** day-bucketed averaging currently happens client-side over that fetched window — acceptable while the profile-stored home IANA timezone (`users.timezone`, ADR-014 / ADR Q1) is not yet plumbed into this module. That stays within the letter of the "no client-side aggregation beyond the fetched window" rule, but the target — required before windows grow past 90 days or aggregations get richer (monthly view, tag correlations) — is a `GET /api/v1/mood/trend?days=` endpoint doing SQL aggregation in the stored home timezone (`date_trunc` over `created_at AT TIME ZONE :home_tz` + `avg(mood_score) … group by day`) so raw rows stop crossing the wire at all.

### Data model

We will store check-ins in Supabase Postgres `mood_checkins` (migration `0003_mood_checkins.sql`), exactly as §4.4 specifies:

| Column       | Type          | Notes                                |
| ------------ | ------------- | ------------------------------------ |
| `id`         | `uuid` PK     |                                      |
| `user_id`    | `uuid` FK     | RLS-scoped, own rows only            |
| `mood_score` | `int`         | `check (mood_score between 1 and 5)` |
| `tags`       | `text[]`      | free vocabulary, chip-driven         |
| `note`       | `text` null   | sensitive — see privacy rules below  |
| `created_at` | `timestamptz` | event time; no date-uniqueness       |

RLS is enabled with own-rows-only policies; a composite index on `(user_id, created_at desc)` serves the window query. MoodModule is the sole owner — no other module reads the table; a future journal↔mood link stores opaque ids and composes in the API (§4.3).

**Multiple check-ins per day (at most five), immutable.** A check-in is an event, not a daily field: re-checking-in creates a new row rather than overwriting, and there is deliberately no `UNIQUE (user_id, day)` constraint and **no PATCH endpoint** — the only mutations are POST (log) and DELETE (undo). Rationale: Phase 2 automations will prompt morning and evening; averaging a day's events gives a truthful trend, while overwrite would silently destroy the morning signal. "Mood not logged yet" in the mock's greeting means _no check-in today_, computed from the newest row's local day — it does not imply a one-per-day schema.

_PO decision:_ **0–5 check-ins per home-timezone day, cap enforced server-side.** The service counts the caller's rows for the current home-timezone day before insert and rejects a sixth with a 409 (see API contract). The cap is a service rule, not a schema constraint — a unique key cannot express "at most five", and the day boundary is a home-timezone derivation (ADR-014), not a storage concern. Enforcing it pulls the `users.timezone` plumbing into `MoodModule`'s write path, so that plumbing is no longer deferrable (it also unblocks the trend-endpoint gap above).

### API contract

We will expose three routes under `/api/v1/mood`, with zod schemas in `packages/contracts/src/schemas/mood.ts` shared verbatim by both sides (ADR-001/007):

- `GET /mood?days=N` → `{ items: MoodCheckin[] }`, newest first; `days` coerced int, 1–90, default 7.
- `POST /mood` with `{ score: 1|2|3|4|5, tags?: string[], note?: string|null }` → the created `MoodCheckin`, or 409 when the caller already has five check-ins in the current home-timezone day (the PO-decided daily cap — see Data model). The write schema is `.strict()` (reject-unknown-fields, §5.2), trims and dedupes tags (≤20, ≤50 chars), caps notes at 1000 chars. `user_id` comes from the verified JWT, never the body.
- `DELETE /mood/:id` → 204, or 404 for missing/foreign/malformed ids.

`score` is a literal union `1|2|3|4|5` (not `int min 1 max 5`), so an out-of-range score is unrepresentable in the type system on both ends.

Error semantics: request-shape violations are 400s (ZodError via the global exception filter); the daily-cap rejection is a 409 with a machine-readable code so the widget can show "5 check-ins today — back tomorrow" instead of a generic error; missing/foreign/malformed ids are uniform 404s; storage faults are opaque 500s with details only in server logs. `createdAt` is normalized to strict UTC `Z` datetimes at the repository boundary so the contract's `z.string().datetime()` holds regardless of PostgREST's offset serialization.

### Accessibility

We will render the 1–5 scale as **five toggle buttons with `aria-pressed`** (as the mock does), _not_ a radiogroup with roving tabindex. This is a deliberate choice, not an oversight. Pressing a face **immediately logs a check-in** (a POST). In the radiogroup pattern, arrow-key movement _selects_ — so a screen-reader or keyboard user arrowing across the scale to hear the options would fire spurious check-ins on every keystroke; and if we deferred the commit to avoid that, we would need a separate submit step that contradicts the one-tap interaction. Five sequential Tab stops with Enter/Space to activate is honest semantics for five independent actions; `aria-pressed` reflects which score today's latest check-in holds, and the group carries `role="group"` with an accessible name ("Mood scale 1 to 5"). Five stops is an acceptable Tab cost; at ten-plus options this trade-off would flip. If the interaction ever becomes select-then-submit, this decision flips to radiogroup with roving tabindex.

Concretely:

- **Faces are labelled with text, not emoji.** Each button carries `aria-label` (`Rough / Low / Okay / Good / Great`) and the emoji glyph is `aria-hidden`. Emoji names ("slightly frowning face") are not mood labels. The current label of the latest score is also shown as visible text in the trend header ("Good · 4/5"), so meaning never rests on emoji rendering alone.
- **The trend chart has a non-hover, non-visual equivalent.** The SVG is `role="img"` with an `aria-label` enumerating the series ("Mood scores for the last 7 days: 3, 4, no entry, …") — the mock's `aria-label` pattern, kept. The mock's hover-only tooltip is rejected: v1 ships **no** hover tooltip, and if one is added it must be paired with keyboard-focusable data points (`tabindex` on point hit-areas, tooltip shown on focus, dismissible per WCAG 1.4.13) — hover-only will not pass review. **Gap vs target:** add a visually-hidden per-day table (`day / average / label`) beneath the chart so screen-reader users can navigate values individually instead of hearing one long string.
- **No color-only encoding.** The trend encodes value by _position_ (y-axis with gridlines at 1/3/5); the amber line color is decoration. Selected faces and active tag chips are distinguished by `aria-pressed` plus a non-color visual cue (border/weight), not hue alone. Contrast targets WCAG 2.1 AA (NFR-11).
- **`prefers-reduced-motion` respected.** Any line draw-in or face-press animation is gated behind the media query; the current implementation animates nothing, which trivially complies — the constraint binds future polish.
- Errors use `role="alert"`; post-submit confirmation and loading state use `role="status"` so they are announced without stealing focus.

### UX states & interaction

We will make the check-in frictionless: tapping a face logs immediately with whatever tags are toggled — no submit button, no confirm. The safety net is **Undo**, not a dialog: after logging, a status line ("Logged Good. Undo") offers a one-tap DELETE of that row — Undo is a real `<button>` in the tab order (announced with the rest of the `role="status"` line, so screen-reader users hear it exists), and its timeout pauses while it has focus or hover (WCAG 2.2.1), per the shared undo pattern (ADR-008). Re-checking-in later the same day just logs another row (see Data model); the widget always reflects the newest. Tag chips are toggled _before_ tapping a face and reset per session — they qualify the next check-in, they are not edits to a past one.

Required states:

- **Loading:** placeholder text in the trend area while the query is pending (target: shell-consistent skeleton card, minor gap).
- **Empty:** "No check-ins yet. Tap a face above to log your first mood." — the scale stays fully usable, so the empty state is itself the affordance.
- **Error:** load failure and save failure render distinct inline `role="alert"` messages inside the widget; the shell's error boundary catches render crashes.
- **Submit:** **Gap vs target.** Current behavior is pessimistic — faces disable while the POST is in flight, state updates on success. Target is optimistic: flip `aria-pressed` and append to the `['mood']` cache in `onMutate`, roll back from the snapshot in `onError` with the existing error alert. Pessimistic is acceptable at personal-app latencies but the optimistic pattern is the committed standard for widget writes (§1.3).
- **Trend axis:** day-of-week labels come from `toLocaleDateString(undefined, { weekday: 'narrow' })` — already locale-driven, satisfying the i18n axis requirement. **Gap vs target:** the widget's other strings (question, labels, errors) are hard-coded English literals; NFR-12 requires them externalized into the message catalog when the i18n scaffolding lands — no new hard-coded strings may be added to this widget.

**Privacy** (§5.2/§5.3, NFR-7) — mood data is a named highest-value asset, so these are hard rules, not preferences:

- No third-party analytics or trackers load on the dashboard, and none may ever be added to mood routes.
- Phase 2 push reminders use generic bodies ("Mood check-in time") — never scores, tags, or note text in a notification payload, which transits vendor push services.
- Server logs record error messages and row ids only, never note content; the repository already follows this.
- Mood data ships in the per-module JSON export endpoint (NFR-7) so the reflections remain the user's to take away.

## Consequences

- **Easier:** the toggle-button + Undo model makes check-in a one-tap habit, which is the whole point of a mood tracker; immutable events make the trend honest and the API surface tiny (no PATCH, no edit conflicts, no upsert races).
- **Safer by construction:** the literal-union score and `.strict()` write schema mean a whole class of bad data is unrepresentable on both ends, not just validated away; the DB check constraint backs it a third time.
- **Reusable pattern:** the chart's position-encoding + `aria-label` series + (target) hidden data table becomes the house accessibility pattern for every future chart widget (streaks, finance) — this ADR is the reference for those reviews.
- **Harder:** multiple-rows-per-day means every consumer must bucket by _local_ day — "today's mood" is a derived question, not a column — and day-bucketing lives client-side until the home-tz `GET /mood/trend` endpoint exists.
- **Committed to:** building the SQL trend endpoint before any window >90 days or richer aggregation ships; pairing any future hover tooltip with keyboard focus equivalence — hover-only regressions are architecturally forbidden by this ADR; keeping mood routes analytics-free permanently; enforcing the 0–5-per-day cap server-side (409 on the sixth), which commits `MoodModule` to the `users.timezone` plumbing on its write path.
- **Tracked gaps** (target recorded above, not yet in code): optimistic submit with cache rollback and the skeleton-style loading state (_PO-review:_ these two UX gaps close first); server-side daily-cap enforcement with the `users.timezone` plumbing it requires; SQL trend aggregation endpoint; visually-hidden data table under the chart; message-catalog externalization of widget copy; a visible (not just assistive) text label for the pressed face.

## Alternatives considered

- **Radiogroup with roving tabindex for the scale** — the textbook ARIA pattern for pick-one-of-five, and better for pure selection. Rejected because arrow-key movement selects in that pattern, and selection here _commits a write_: it would either log spurious check-ins while navigating or force a separate submit step, killing the one-tap interaction. Toggle buttons state the truth: five actions, one currently pressed.
- **One check-in per day with overwrite (UPSERT on `(user_id, day)`)** — matches the mock's "mood not logged yet" greeting and simplifies "today's mood". Rejected: it destroys intra-day signal that Phase 2's morning/evening prompts will generate, bakes a server-side notion of "day" into the schema (day boundaries are a home-timezone derivation concern, ADR-014, not a storage key), and needs a PATCH/UPSERT path where the event model needs only POST + DELETE.
- **Client-computed trend over full history** — no windowing, fetch everything, bucket in the browser. Rejected: unbounded payload growth for an append-forever table violates NFR-2 and the spirit of ADR-004 (the API owns querying). The adopted design windows server-side now and moves averaging into SQL next.
- **Edit-in-place instead of Undo (PATCH endpoint)** — rejected: for an immutable event log, "I mistapped" is a delete, not an update; a PATCH surface invites treating check-ins as mutable documents and doubles the validation surface for no UX gain.
- **Ship the mock's hover tooltip as-is** — rejected outright: hover-only fails keyboard and touch users (WCAG 2.1.1), and the mock's `role="status"` tooltip announces on hover but is unreachable otherwise. The `aria-label` series summary ships instead; a tooltip may return only paired with focusable points.
- **Charting library (Recharts/visx) for the trend** — rejected for one static 7-point sparkline: a hand-rolled 40-line SVG matches the mock's geometry exactly, adds zero dependencies (NFR-8, bundle size), and keeps full control of the accessibility tree, which libraries routinely get wrong.
- **Store mood in MongoDB alongside journal entries** — superficially attractive since both are "reflection" data. Rejected by §4.3: check-ins are fixed-shape rows queried with filters and aggregations (trends, future streaks) — exactly the Postgres column of the split — and Postgres RLS gives them the second authorization net Mongo lacks.
- **Show only today's latest score (no averaging) in the trend** — simpler, but a day with a rough morning and a good evening would render as purely good; the per-day average preserves both signals, and the (target) hidden data table exposes the exact values for anyone who wants them.
