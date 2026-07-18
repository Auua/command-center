# ADR-039: Automation delivery — inline tick behind an external pinger (MVP)

- **Status:** proposed
- **Date:** 2026-07-18
- **Review:** claude-reviewed

## Context

Phase 2 delivers the automation engine: `AutomationModule`, `NotificationModule`, the
`automations`/`automation_runs`/`push_subscriptions` tables, and Web Push (ADR §4.1, §4.4, §4.5).
As drafted, §4.5 assumed a pg-boss queue (ADR-005) consumed by an always-on worker process, and
ADR-006 explicitly deferred where that process runs ("a long-running queue consumer doesn't fit
Vercel functions — revisit when the Phase-2 worker lands").

The 2026-07-18 planning pass put numbers on that revisit:

- **Vercel Hobby cron is daily-only**, and invocations may fire anywhere within the scheduled
  hour — a 1-minute tick with NFR-3's 60 s SLO cannot be expressed on the current (free) plan.
- **Vercel Pro ($20/mo)** unlocks per-minute cron but consumes the entire NFR-8 budget, and
  fetch-mode pg-boss inside short function invocations re-implements by hand what `work()` gives
  a persistent process.
- An always-on worker host costs ~$5/mo (Railway Hobby) or ~$2.30/mo (Fly machine); free tiers
  that sleep (Render free — where background workers are paid-only anyway) miss schedules by
  construction.

The product owner then relaxed the requirement that forced the persistent process: **on-time
delivery of timed notifications is not mandatory for the MVP** — best effort is acceptable,
provided nothing is silently lost. NFR-3's 60-second SLO was the only force demanding an
always-on consumer. With it relaxed, the question becomes: what is the simplest architecture
that fires reminders _roughly_ on time, never loses one, and never notifies twice?

Constraints inherited and unchanged: ADR-015's widget contract (server-expanded today view,
`schedule jsonb` compiled server-side, toggle semantics, run statuses surfaced per slot),
notify-only actions (§5.3), non-sensitive push bodies (§5.2), RLS on all tables (§5.1),
NFR-8 (≈ free), NFR-10 (observability).

## Decision

We will run the Phase-2 automation engine **entirely inside the existing Vercel-hosted API**,
triggered over HTTP by a free external cron service. No worker process, no queue, no second
hosting platform. ADR-005 (pg-boss) is **deferred, not implemented** — nothing in this shape
needs a queue — and ADR-006's revisit clause is resolved: nothing moves off Vercel.

### Delivery contract (NFR-3 restated)

Timed notifications are **best-effort**: typically within ~1–5 minutes of schedule, possibly
later, at-least-once with idempotent dedupe (no double-notify per slot), and **every fire is
recorded in the notification center regardless of push outcome** — the in-app bell row, not the
push, is the delivery of record. Slots missed by more than a 60-minute catch-up cap are recorded
as `skipped`, visibly, instead of firing stale.

### Tick transport

- A free external cron service (**cron-job.org**, 1-minute intervals on the free tier, with
  failure notifications enabled) sends `POST /api/v1/internal/tick` to the API.
- The route is guarded by a shared secret (`x-tick-secret` header compared against the
  `TICK_SECRET` env var), **not** by the global Supabase-JWT guard — an explicit, tested
  exclusion, making this the API's second non-JWT route after `/health`.
- The request carries no usable input: the tick takes **no parameters** — body and query are
  ignored entirely, so there is nothing to inject. The response is `204 No Content` (no counts,
  no timings — nothing for an unauthenticated caller to learn).

### Inline scheduler run

Each tick, a `scheduler` module (API-side, no HTTP fan-out) does the §4.5 pipeline synchronously
— at personal scale (tens of automations, a few subscriptions) this is well under a second:

1. Read `scheduler_state.cursor_at` (high-water mark; first run initializes to now − 1 min).
2. Window = `(max(cursor_at, now − 60 min), now]` — the catch-up cap bounds how stale a
   delivered reminder can be.
3. Load enabled `kind='recurring'` automations joined to the user's stored IANA timezone;
   expand occurrence slots with the same `ScheduleEvaluator` that serves ADR-015's
   `GET /automations/today` (one implementation; slots are UTC instants, so DST is unambiguous).
4. **Claim before send:** `INSERT INTO automation_runs (automation_id, user_id, slot, status
'pending') ON CONFLICT (automation_id, slot) DO NOTHING RETURNING id`. No row returned means
   an overlapping tick already owns the slot — concurrency-safe without a queue; the unique key
   is NFR-3's idempotent dedupe made structural.
5. For each claimed slot: re-check `enabled` (disabled since expansion → `skipped`), write the
   bell `notifications` row, fan out Web Push to all of the user's subscriptions (pruning
   endpoints that return 404/410), then update the run to `sent` or `failed` (+ `fired_at`,
   `error`). `sent` requires the bell row written and, if any subscriptions exist, ≥ 1 push
   accepted.
6. Slots older than the catch-up cap are inserted directly as `skipped` (`ON CONFLICT DO
NOTHING`).
7. `pending` rows older than 5 minutes (a crashed invocation between claim and status write) are
   re-processed on the next tick — bounded self-healing retry; at-least-once is the accepted
   residue and the OS-level notification `tag` (automation id + slot) collapses rare duplicates.
8. Advance `cursor_at = now`, stamp `last_tick_at`.

`pending` is internal-transient: ADR-015's today endpoint surfaces it as "no outcome yet", never
as a user-facing status.

### Event automations

"After finishing a task" gets **faster**, not slower: the `task.completed` listener (in-process
event bus, §4.1) matches the emitting user's enabled `kind='event'` automations and dispatches
through the same claim → bell → push tail immediately, with `slot` = the event timestamp. No
tick, no queue hop.

### Security posture

This ADR was drafted with an explicit security pass; the findings are part of the decision:

- **`TICK_SECRET`:** ≥ 256-bit random value, compared in constant time
  (`crypto.timingSafeEqual` over digests), stored only in Vercel env and the pinger's job
  config. Mismatch → 401 with no body; the route sits behind `@nestjs/throttler` (§5.2) so
  secret-guessing is rate-capped.
- **Blast radius of a leaked tick secret is deliberately near-zero:** the endpoint accepts no
  input and the claim step is idempotent, so an attacker who has it can only run the scheduler
  early/often — no data read, no double notifications, bounded DB load (throttled). This is why
  a shared secret, rather than heavier auth, is proportionate: the third party (cron-job.org)
  holding the URL + secret is trusted with _timeliness only_, never with data or correctness.
- **Service-role carve-out (§5.1 amendment):** the tick has no user JWT, so the scheduler
  repository uses a Supabase **secret (service-role) key** — the system's first RLS-bypassing
  credential in the API process. Containment: server-only env var (never `NEXT_PUBLIC_*`, never
  in the client bundle), consumed by exactly one repository (`scheduler`), never logged, and
  rotatable from the Supabase dashboard. Every user-facing endpoint stays on the anon-key +
  user-JWT client under RLS. HTTPS-based supabase-js also fits serverless better than holding
  raw Postgres connections in functions.
- **Push-endpoint SSRF is closed at registration:** `push_subscriptions.endpoint` is
  client-supplied, and Web Push means the server POSTs to it — an unvalidated endpoint would let
  an authenticated client aim VAPID-signed server requests at arbitrary or internal hosts. The
  subscription endpoint therefore accepts **HTTPS URLs on known browser push-service hosts only**
  (Google FCM, Apple, Mozilla, Windows push domains); anything else is rejected at the contract
  layer.
- **Push content and endpoints:** §5.2 stands — payloads encrypted per the Web Push spec, VAPID
  keys server-side only, titles/bodies validated as short plain text with no journal/mood
  content. Push endpoints are unguessable capability URLs and are **never logged in full**
  (hash/prefix only).
- **Non-issues, verified:** CSRF does not apply (no cookie auth on the tick route; custom-header
  secret; server-to-server, so CORS is irrelevant); `cron_expr` is never user input (compiled
  server-side from the validated `schedule` descriptor, ADR-015); §5.3's tampering bound holds —
  actions remain notify-only, so a compromised automation row can annoy, not exfiltrate; the dev
  rule from planning applies — a local tick must never point at the production database or send
  from production VAPID keys.

### Monitoring (NFR-10)

- cron-job.org's own failure alerts cover "tick endpoint erroring/timing out" — the pinger is
  its own dead-man's switch, for free.
- `/health` gains a tick-staleness read from `scheduler_state` (`last_tick_at` age);
  the existing UptimeRobot check upgrades to a keyword monitor on it.
- The Phase-0 worker heartbeat stub stays as-is; no new process exists to watch.

### Recorded upgrade path

If best-effort ever annoys in practice, the full design from the same planning pass slots in
behind identical tables and the identical evaluator, with zero frontend change: an always-on
worker (existing `apps/api/Dockerfile`, `node dist/worker`) on Railway Hobby (~$5/mo,
europe-west4; Fly machine ~$2.30/mo as cost runner-up), pg-boss v10 over the Supabase
**session-mode** pooler (never transaction mode; the direct host is IPv6-only on the free tier),
pg-boss cron as the tick, `singletonKey` + the same unique slot key as the two-layer dedupe.
The pinger and `TICK_SECRET` are then retired.

## Consequences

- **Infrastructure cost stays $0/mo** and there is exactly one deploy pipeline — ADR-006's
  "one platform" rationale survives Phase 2 intact.
- The riskiest planned integration (pg-boss ↔ Supabase pooler in a persistent process) and the
  worker's handler logic leave the MVP entirely; the scheduler is plain, testable service code
  behind one controller.
- Timeliness now depends on a free third party. That is the accepted trade: a missed ping delays
  delivery until the next successful one (catch-up window), and the cap + `skipped` status keep
  lateness honest instead of silent. Correctness never depends on the pinger.
- The API holds two privileged secrets it previously did not: the Supabase service-role key
  (confined to the scheduler repository) and `TICK_SECRET`. §5.1's "no privileged DB credential
  in the API" posture is formally amended by the containment rules above.
- A failed push is not retried beyond the stale-`pending` sweep; the bell row plus ADR-015's
  "! not delivered — check the bell" copy is the recovery path. Acceptable under the relaxed
  contract; a retry queue is exactly what the deferred pg-boss design adds back.
- Owed on acceptance (per the ADR §7 convention): NFR-3's row rewritten to the best-effort
  contract; §4.5's "Automation fires" sequence redrawn (pinger → tick → inline dispatch, no
  queue); §4.4 gains `user_profiles`, `notifications`, `scheduler_state`, the `automations.name`
  - `schedule` columns and `automation_runs.slot`/`user_id`/`pending`; §5.1 gains the
    service-role carve-out; ADR-005's row gains the deferral note and ADR-006's row loses its
    revisit clause. ADR-015 is **not** revisited — its widget-facing contract is unchanged.

## Alternatives considered

- **Always-on worker + pg-boss now (Railway ~$5/mo):** the original Phase-2 shape; fully
  designed and kept as the recorded upgrade path. Deferred because the relaxed delivery contract
  no longer justifies a second platform, a second deploy pipeline, and the riskiest integration
  in the phase for a personal app's reminders.
- **Vercel Hobby cron:** daily-only, hour-loose — cannot express any sub-daily reminder;
  a "12:00" reminder arriving in a 03:00-04:00 batch is a digest, not a reminder. Rejected.
- **Vercel Pro for per-minute cron ($20/mo):** the entire NFR-8 budget for the option that still
  fights fetch-mode pg-boss. Rejected.
- **GitHub Actions scheduled workflow as the pinger:** free, but 5-minute minimum granularity
  with notoriously loose/dropped scheduling under load, and it couples reminder delivery to the
  CI platform. cron-job.org is purpose-built and alerts on failure. Rejected.
- **Supabase pg_cron + edge functions:** ADR-005's original objection stands — splits automation
  logic out of NestJS into a second runtime, and a second trigger path is precisely the
  double-fire risk the dedupe exists to contain. Rejected.
- **Unauthenticated tick endpoint ("idempotency is defense enough"):** the claim step does make
  abuse mostly harmless, but a secret header costs one env var and removes the open invitation
  to poke at DB-touching code. Rejected — cheap defense in depth.
- **Raw Postgres (`DATABASE_URL`) from the API for the scheduler:** holding pooled TCP
  connections in serverless functions is exactly the operational trap the service-role HTTP
  client avoids; and it would put a _connection-string_ credential on Vercel instead of a
  rotatable API key. Rejected for the MVP; returns naturally with the worker upgrade path.
- **Accepting arbitrary HTTPS push endpoints:** simpler contract, but turns the API into a
  VAPID-signed request proxy aimed wherever a client says (SSRF). The known-push-host allowlist
  costs a regex set. Rejected.
