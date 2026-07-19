# ADR-002: NestJS modular monolith (extraction path, not microservices)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

The product brief describes "modular backend services" — learning, tasks, automations, mood,
journal are clearly separate domains with separate data and separate failure modes. But this is
a single-user personal system: there is no scale pressure, no team-boundary pressure, and G2
(low operational burden) plus NFR-8 (≤ €20/mo) actively punish every additional deployable.
The tension to resolve: keep the domain separation real enough that the architecture doesn't
rot into a ball of mud (and extraction stays possible if a module ever needs isolation),
without paying the distributed-systems tax on day one.

## Decision

We will build the backend as **one NestJS deployable — a modular monolith** — and realize
"modular backend services" as _modules inside one process_, each under
`apps/api/src/<module>`, until scale or isolation demands extraction.

Module rules (enforced via ESLint boundaries):

- **Domain modules never import each other directly.** Cross-domain reactions go through the
  in-process event bus (`@nestjs/event-emitter`): `TasksModule` emits `task.completed`;
  `AutomationModule` subscribes and evaluates smart reminders. The emitter never knows who
  listens.
- **Each module owns its persistence** — its tables or collections, its repositories. No shared
  repositories across modules, no reaching into another module's data (the one endpoint that
  tried was rejected at review, ADR-012).
- **Every module has the same internal shape**: thin REST controller(s) → service layer
  (where the rules live) → repository, plus optional event handlers.
- Cross-cutting concerns (auth guard, notifications, automation scheduling, widget registry)
  are core modules with the same rules.

The worker is the same codebase behind a separate entrypoint and process (`dist/worker`) so a
stuck job never blocks interactive requests — process isolation where it pays, without a second
service (ADR-005/006).

## Consequences

- One deploy target, one log stream, one thing to keep alive — G2 and NFR-8 hold.
- Extraction stays cheap by construction: a module that owns its persistence, exposes only
  REST + events, and imports no siblings can be lifted out with its tables and a message
  transport swapped in for the event bus. This is a documented escape hatch, not a plan.
- The event bus is in-process and non-durable: events fired while the process is down are
  lost. Acceptable for v1's event uses (streaks, smart reminders — worst case a missed nudge);
  anything needing durability goes through the pg-boss queue instead (ADR-005).
- Module boundaries are only as real as their enforcement — the ESLint boundary rules are
  load-bearing, and reviews treat a cross-module import as an architecture violation, not a
  style nit.
- Refactors that would be API-versioning events between services are plain code changes here —
  the monolith is _more_ agile for a solo developer, not less.

## Alternatives considered

- **Microservices from day one** — matches the "services" language in the brief, but brings
  service discovery, deploy orchestration, distributed tracing, and N× hosting cost to a system
  with one user and zero scale need. Rejected: all of the operational burden, none of the
  benefit.
- **Plain monolith without enforced boundaries** — least ceremony, but domain separation
  documented only in prose erodes with every deadline; extraction becomes a rewrite instead of
  a lift. Rejected: the ESLint rules cost minutes and keep the option real.
- **Serverless functions per domain** (e.g., Supabase Edge Functions or Vercel functions as the
  backend) — no server to keep alive, but domain logic scatters across per-function bundles,
  the NestJS learning goal (G3) evaporates, and long-lived concerns (queue consumer, cron
  evaluation) don't fit the model. Rejected here; resurfaces and is rejected again with fuller
  argument in ADR-004.
