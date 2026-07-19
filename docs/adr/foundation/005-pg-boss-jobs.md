# ADR-005: Jobs and scheduling via pg-boss on Supabase Postgres + a worker process

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

The automation domain (Phase 2 — deliberately scheduled before more widgets because it carries
the highest architectural risk) needs background machinery: cron evaluation for time-based
reminders, a queue for dispatch jobs (web push, streak rollover, content prefetch), retries,
and idempotent delivery. NFR-3 sets the bar — an automation fires within 60 s of schedule,
at-least-once, with dedupe so no slot double-notifies. The classic answer is BullMQ on Redis,
but that adds a service to host, secure, and pay for, against G2 (low ops) and NFR-8 (≤ €20/mo)
— and a Postgres instance with spare capacity is already running (ADR-003).

## Decision

We will run jobs and scheduling on **pg-boss**, using the existing Supabase Postgres as the
queue store, consumed by a **worker process** that is the same NestJS codebase behind a
separate entrypoint (`dist/worker`, ADR-002):

- **Zero additional infrastructure**: the queue is tables in a database already provisioned,
  backed up, and paid for (free tier).
- **Transactional enqueue**: a domain write and its follow-on job commit in one Postgres
  transaction — no outbox pattern needed to avoid the "row saved, job lost" gap.
- **The worker ticks cron once a minute**, selects automations due in that slot (tz-aware),
  and enqueues notify jobs with an idempotency key of `automation_id + slot`, making NFR-3's
  no-double-notify a queue-level guarantee rather than application bookkeeping.
- **Process separation, not service separation**: the worker shares modules and repositories
  with the API but runs apart, so a stuck or slow job never blocks interactive requests.

Scope note: Anki sync is _not_ a worker job — it runs as a GitHub Action in the learning repo
(ADR-026). The worker's job classes are push dispatch, streak/day rollover, content prefetch,
and provider polling loops added by later ADRs (021, 033, 037).

## Consequences

- No Redis to run, secure, or pay for; NFR-8 holds with margin.
- Queue throughput is bounded by Postgres — irrelevant at personal scale (a handful of jobs
  per hour), and the trigger to revisit is load, which there is a documented migration
  target for (BullMQ) if it ever appears.
- Queue tables live beside domain data in the same database: one backup story, but also one
  blast radius — a runaway queue could consume the shared free-tier quota. Accepted at this
  scale.
- The worker requires a **persistent process**, which the current hosting platform does not
  natively provide for long-running consumers — recorded as ADR-006's standing constraint and
  decided when Phase 2 lands, not before. Until then the worker exists as an entrypoint
  (`pnpm --filter @command-center/api start:worker`) exercised locally. _ADR-039 (proposed,
  2026-07-18) defers this ADR for the Phase-2 MVP: with NFR-3 relaxed to best-effort, the
  automation engine runs inline in the API behind an external pinger and needs no queue; the
  pg-boss + always-on-worker design is recorded there as the upgrade path._
- At-least-once delivery means handlers must be idempotent; the `automation_id + slot` key and
  patterns like ADR-027's PK day-marks are the house idiom for that.

## Alternatives considered

- **BullMQ + Redis** — the ecosystem default, better tooling and throughput, but +1 managed
  service to host and pay for, and enqueue can no longer share a transaction with the domain
  write. Rejected for v1; named as the migration target if queue load ever demands it.
- **Supabase cron (pg_cron) + edge functions** — schedule and execution fully inside Supabase,
  but automation logic splits out of the NestJS modules into edge-function bundles, with the
  event-bus integration (`task.completed` → smart reminders) severed from the code that emits
  it. Rejected: ADR-002/004 put domain logic in one place; this scatters it.
- **In-process scheduling in the API** (`@nestjs/schedule` + in-memory jobs) — no queue at
  all; but jobs die with each deploy or crash, nothing is durable, and NFR-3's at-least-once
  cannot be honestly claimed. Rejected for automations; fine for incidental in-process
  concerns.
- **Vercel cron hitting an API endpoint** — viable for pure ticking, and noted in ADR-006 as
  a candidate shape for hosting the tick — but it provides no queue semantics (retries,
  dedupe, backoff) by itself; pg-boss remains the queue either way.
