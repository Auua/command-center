# ADR-029: Fitness & health widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending product-owner approval

## Context

The README lists "fitness & health widgets" under Future Extensions; the ARD names them in G4. Nothing is implemented — this is a planning ADR, and the honest scoping decision is the whole content.

The gravitational pull of this widget is **device integration**: Garmin, Apple Health, Strava, Withings. It is the first thing anyone imagines when they hear "fitness widget", and it is uniformly a bad fit for this system's constraints:

- **Apple Health has no server API at all.** HealthKit is readable only by a native iOS app on-device — no OAuth endpoint a NestJS backend can call. Integrating it means shipping a native app, an explicit ARD non-goal (§1.3).
- **Garmin's Health API is a partner program** (application, approval, terms) delivering push-to-your-endpoint with ping/backfill semantics — a public webhook receiver, replay handling, per-user token custody in the worker.
- **Strava/Fitbit/Withings** are ordinary OAuth 2.0, but each brings refresh-token custody, rate limits, webhook subscriptions, and a silently-stale re-auth failure mode — the exact bundle ADR-018 rejected for calendar sync ("OAuth token custody, webhook/poll infra in the worker, and conflict policy dwarf the widget itself").

Same shape of decision, so it gets the same answer for the same documented reasons (G2 low ops, NFR-8 ≤€20/mo) — with the same discipline: **defer with an explicit extension path and a schema seam, not a vague "maybe later".**

Second force: privacy. Health data — weight, resting HR, sleep, injuries in a workout note — is not casual telemetry. §5.3 names "journal + mood data" as the highest-value asset; **health data joins that tier**, and this ADR says so explicitly so reviewers don't have to infer it. Third: this is the second real chart widget, so it inherits ADR-009's chart accessibility contract — and is the natural place to deliver the parts ADR-009 recorded as gaps.

## Decision

### Scope: manual logging in v1

We will ship **manual logging only**: workouts (what, how long, how hard) and body metrics (weight, resting HR, whatever numeric series the user cares about), plus trend charts. **All device/service integrations are explicitly deferred** — Apple Health permanently unless the native-app non-goal changes; Garmin/Strava/Fitbit as a possible later ADR.

Rationale, concretely: an OAuth integration is roughly the whole widget's effort again (consent flow, encrypted refresh-token storage, worker poll/webhook receiver, dedupe against manual entries, stale-token re-auth UX), it adds a paid/partner dependency risk against NFR-8, and it is unnecessary to answer the question the widget exists to answer ("am I moving, and is the trend going the right way?"). Manual logging also produces the higher-quality data for the metrics that actually matter here (weight, subjective effort), which no wearable measures well anyway.

**The extension path is designed in now**, mirroring ADR-018's `source`/`external_id` seam: every row carries `source` (`"manual"` by default) and `external_id` (nullable, unique per source), so an importer becomes _another writer into the same tables_ without touching the read contract or any client. A CSV/GPX import path (Strava export, Garmin export) is the cheap 80% and can land without any OAuth at all — flagged as Q-A.

### Frontend

One folder `apps/web/widgets/fitness/`, one registry entry (§4.2):

- `id: "fitness"`, `sizes: ["2x2", "4x2", "4x3"]`; standard error + suspense boundaries.
- Card body: this week's workout summary (count, minutes, a 7-bar strip) plus one pinned metric trend (weight by default). At `4x3`, both a workout list and the metric chart.
- `quickActions: [{ id: "log-workout", … }, { id: "log-metric", … }]`; `settingsSchema` (zod): `{ pinnedMetric: string (default "weight"), unitSystem: "metric" | "imperial", trendDays: 30 | 90 | 365 (default 90), showWorkoutList: boolean }`.
- The **history surface lives at `/fitness`** (a real route — ADR-018's widget-vs-destination split): full workout log, per-metric charts, date filtering. A year of weight data is not a dashboard card.
- Data via generated hooks in `packages/contracts` (ADR-007); no direct Supabase access (ADR-004).

### Backend

A new `FitnessModule` (domain module, §4.1): thin controller → service → own repository, importing no other domain module.

- Logging a workout emits `workout.logged` (`{ userId, workoutId, localDate, kind, durationMin }`) on the event bus. `StreaksService` (ADR-014) adds one `EVENT_TO_STREAK` entry (`workout.logged` → `fitness`); `AutomationModule` (ADR-015) can offer it as an event trigger. `FitnessModule` computes no streaks and schedules no reminders — same division of labour as ADR-027.
- **Trend aggregation is SQL, server-side**, in the stored home timezone (`date_trunc` over `recorded_at AT TIME ZONE :home_tz`) — not raw rows for the client to bucket. ADR-009 shipped client-side bucketing and recorded it as a gap; a widget whose default window is 90–365 days cannot repeat that (NFR-2).
- `local_date` uses ADR-014's home-tz + 03:00 grace boundary, so "did I work out today" agrees with streaks.

### Data model

Postgres, owned solely by `FitnessModule`, RLS `user_id = auth.uid()` (§5.1). Two tables — a **narrow-table metric series**, not a wide row of columns, so a new metric is data, not a migration:

```sql
workouts (
  id          uuid PK default gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users,
  kind        text NOT NULL,               -- "run" | "strength" | "cycle" | … (user-extensible vocabulary)
  started_at  timestamptz NOT NULL,
  duration_min int NOT NULL CHECK (duration_min between 1 and 1440),
  distance_m  int,                         -- nullable; SI base unit, formatted per unitSystem
  intensity   int CHECK (intensity between 1 and 5),   -- subjective RPE
  note        text,                        -- SENSITIVE (injuries, how the body feels)
  local_date  date NOT NULL,
  source      text NOT NULL DEFAULT 'manual',
  external_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id)    -- import idempotency; NULL external_id never collides
);

health_metrics (
  id          uuid PK default gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users,
  metric      text NOT NULL,               -- "weight" | "resting_hr" | "sleep_hours" | …
  value       numeric NOT NULL,            -- always in SI/canonical unit (kg, bpm, hours)
  recorded_at timestamptz NOT NULL,
  local_date  date NOT NULL,
  source      text NOT NULL DEFAULT 'manual',
  external_id text,
  UNIQUE (user_id, metric, local_date, source)   -- one value per metric per day per source
);
```

Decisions embedded above:

- **Units are stored canonically (kg, metres, bpm) and converted at the presentation layer**, driven by the `unitSystem` setting. Storing "whatever the user typed" is the bug that makes every later chart wrong.
- **`UNIQUE (user_id, metric, local_date, source)`** makes a day's weight idempotent: re-logging replaces (upsert), a retried import cannot double-write. Same "duplicate is unrepresentable" instinct as `streak_days` (ADR-014) / `habit_marks` (ADR-027). Multiple weigh-ins in one day are _not_ preserved — unlike mood (ADR-009), intra-day variance in body weight is noise, not signal. Stated explicitly because it is the opposite call from ADR-009 and a reviewer will notice.
- Metrics are a **narrow (`metric`, `value`) series**, so adding "VO2max" or "waist" is a settings entry, not a migration. Cost: no per-metric type checking in the schema — validated by a metric registry in the contracts package (allowed keys, unit, sane range) instead.
- Indexes: `(user_id, local_date desc)` on `workouts`; `(user_id, metric, local_date desc)` on `health_metrics`.

### API contract

Under `/api/v1/fitness`, zod in `packages/contracts`, `.strict()` writes, `user_id` always from the JWT:

- `POST /workouts`, `PATCH /workouts/:id`, `DELETE /workouts/:id` (204; undo path, ADR-008).
- `GET /workouts?from&to` — required range, max span 366 days (400 beyond), like ADR-018.
- `POST /metrics` `{ metric, value, recordedAt? }` → upsert for that local day; `DELETE /metrics/:id`.
- `GET /metrics/:metric/trend?days=N` → `{ metric, unit, points: [{ localDate, value }], stats: { min, max, avg, delta } }` — **SQL-aggregated server-side**, N ≤ 365.
- `GET /fitness/summary` → this week's counts/minutes for the card.
- Fitness data ships in the per-module JSON export endpoint (NFR-7).

### Accessibility

The trend chart follows and **completes** the ADR-009 chart pattern — this widget delivers what ADR-009 listed as gaps:

- The SVG is `role="img"` with an `aria-label` summarising the series ("Weight, last 90 days: 71.2 kg down to 69.8 kg, 34 entries"), **plus a visually-hidden data table** (`date / value`) so values are individually navigable instead of crammed into one label string. This is now the house standard; charts without it do not pass review.
- **No hover-only tooltips** — if one ships, points must be keyboard-focusable, shown on focus, dismissible per WCAG 1.4.13 (the ADR-009 rule, restated because charts are where it keeps getting broken).
- Value is encoded by **position** (y-axis, labelled units); line/bar color is decoration. Workout intensity is text ("hard, 4 of 5"), never color alone (WCAG 1.4.1). Contrast AA in both themes; draw-in/bar-grow animations gated behind `prefers-reduced-motion` (NFR-11).
- The workout log is a semantic `<ol>` with date headings; the form uses native `<input type="number">`/`<input type="date">` with the unit in the **label** ("Weight (kg)"), not a placeholder. Copy externalized; numbers via `Intl.NumberFormat` (NFR-12) — unit system is a display concern, never a storage one.

### UX states & interaction

- **Logging is fast or it doesn't happen.** The quick action opens a small form prefilled with today's date and the last-used kind; only duration is required. Optimistic write, `role="status"` confirmation, **Undo** rather than a confirm dialog (ADR-008: focusable Undo button, timeout paused on focus/hover).
- **Loading:** skeleton bars + rows. **Empty:** "No workouts logged yet — log one to start the trend." **Error:** the widget's fallback card with retry (§4.2, NFR-4).
- **No goals, no shaming.** Consistent with ADR-014/027: the widget shows what happened, not what you failed to do. No "you're behind on your weekly target", no red deficits, no automatic nudges. A weekly target is an **opt-in setting** rendered neutrally (progress, not deficit); reminders stay the Automation widget's job (ADR-015). Weight trends get **no judgement styling** — up is not red, down is not green; the line is one color.

### Privacy

Health data is a **highest-value asset (§5.3, same tier as journal + mood)** — stated here so it is not left to inference:

- No third-party analytics or trackers on fitness routes, ever (NFR-7) — the hard rule ADR-009 set for mood, inherited.
- Push bodies never contain values ("Time to log your weight", never "You're at 69.8 kg") — payloads transit vendor push services (§5.2).
- Server logs record row ids and error codes only — never `note` content or metric values. The `note` field is the sharpest edge (injuries, illness, how the body feels) and is treated like a journal entry: never logged, never in a notification, always in the export.
- RLS + JWT-derived `user_id` as everywhere; a future import path must not become an unauthenticated ingest endpoint.

### Open questions for the product owner

- **Q-A:** CSV/GPX import (Strava/Garmin export files, no OAuth) — worth it in v1? Reuses the `source`/`external_id` seam, needs no token custody. Probably the right answer if manual logging ever feels tedious.
- **Q-B:** which metrics actually matter? The narrow-table model makes this a settings question, but the registry needs a starting list (weight, resting HR, sleep hours?).
- **Q-C:** one row per workout vs sets/reps detail for strength training. v1 assumes the coarse row; `sets jsonb` is the obvious extension and the one place a Mongo argument could be made (§4.3) — currently rejected as premature.

## Consequences

- The widget is buildable in a weekend and useful immediately, with zero new external dependencies, zero token custody, and zero worker jobs (NFR-8, G2).
- The `source`/`external_id` seam means an integration later is _additive_: a new writer, no read-contract change, no client change. The deferral costs nothing structurally — the ADR-018 property, reproduced.
- **We are committed to Apple Health being out of reach** for as long as "no native apps" (§1.3) holds. Anyone asking for it is really asking to revisit a non-goal, and this ADR is where that gets said.
- The narrow metric table means "add a metric" never touches the database — but it also means the DB cannot type-check values; the contracts-package metric registry becomes load-bearing and must be tested.
- Committing to server-side SQL aggregation from day one means this widget pays ADR-009's deferred bill rather than deferring it again; the hidden-table chart pattern becomes the enforced house standard.
- Declaring health data highest-value tier means fitness routes inherit the mood/journal rules permanently: no analytics, no values in notifications, no note content in logs.

## Alternatives considered

- **Garmin / Strava / Fitbit OAuth integration in v1.** Rejected: token custody + webhook/poll infra + stale-auth UX + dedupe-against-manual is a bigger project than the widget, against G2 and NFR-8 — the identical calculus ADR-018 applied to calendar sync. Deferred _with_ the schema seam, not abandoned.
- **Apple Health integration.** Rejected as **not possible** within the ARD's constraints, not merely expensive: HealthKit has no server API; reading it requires a native iOS app, an explicit non-goal (§1.3). Saying "later" here would be dishonest.
- **Wide metrics table (one column per metric: `weight`, `resting_hr`, …).** Rejected: every new metric is a migration and every row is mostly NULL; the narrow series costs one index and buys extensibility.
- **Store the value in whatever unit the user typed, with a `unit` column.** Rejected: every aggregation and chart then has to convert (or silently doesn't), and mixed-unit series are the classic health-app bug. Canonical storage, presentation-layer conversion.
- **Multiple weigh-ins per day preserved (the ADR-009 event model).** Rejected here, deliberately: intra-day body-weight variance is water, not signal, and averaging it would make the trend noisier, not truer. Mood's multiple-per-day rule is right _for mood_; it does not generalize.
- **Sets/reps/exercise-level strength logging in v1.** Rejected as premature: it triples the model to serve a use case the user has not stated. The coarse workout row is the falsifiable v1; if it proves too coarse, `sets jsonb` is the extension.
- **Store workouts in MongoDB** (free-shape activity documents). Rejected by §4.3: numeric series queried with filters and aggregations are the Postgres column of the split, and RLS gives the second authorization net that health data — as a top-tier asset — most needs.
- **Goal/target-driven UI (rings, "you're behind") as the default.** Rejected: the ADR-014 wellbeing position applies with extra force to body data. Targets are opt-in and rendered neutrally.
