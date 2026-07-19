# ADR-004: All domain traffic through the NestJS API; Supabase direct only for auth + realtime

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

Supabase can serve as an entire backend: PostgREST gives every table a REST surface, RLS
policies express authorization, and edge functions hold whatever logic remains. With a NestJS
API also in the picture (ADR-002), every widget faces a choice of path — client → Supabase
directly, or client → API → database. Two paths means authorization logic lives in two
languages (RLS SQL _and_ API guards) and must be kept equivalent by hand; drift between them
is a security bug that no type checker catches. There is also a learning-goal dimension (G3):
the NestJS backend is half the point of the project.

## Decision

We will route **all domain reads and writes through the NestJS API** (versioned `/api/v1`,
JWT-authenticated). The frontend talks to Supabase **directly only** for two things the API
cannot reasonably intermediate:

1. **Auth flows** — sign-in, session refresh, via `@supabase/ssr` cookies. Supabase Auth is
   the identity provider; proxying its protocol would add surface without adding control.
2. **Realtime subscriptions** — live updates ride Supabase's websocket infrastructure, where
   RLS is the enforcement point by construction.

Supporting rules:

- The API is the **single authorization point**: the global guard verifies the Supabase JWT
  (against JWKS — asymmetric, no shared secret), extracts `user_id`, and every repository
  query is scoped by it. `user_id` comes from the token, never from a request body.
- **RLS stays on** for every Postgres table — as a second net under the application checks,
  and as the _only_ net for the client's direct realtime subscriptions. The API connects with
  an RLS-respecting role, not `service_role`, wherever practical.
- **Mongo has no client path at all** (ADR-003) — API-only is its sole access mode, so this
  ADR is what makes the dual-DB split coherent from the client's point of view.
- Widgets fetch through generated hooks in `packages/contracts` (ADR-007); no widget imports
  a database client.

## Consequences

- Authorization decisions live in one codebase, testable with ordinary unit tests; RLS is
  defense in depth rather than a second implementation that must be kept in sync for writes.
- External providers inherit the rule: every later integration (market data, weather, GitHub
  learning repo, Google Calendar) puts its credential server-side because "the client calls
  the API, the API calls the world" is already the shape. ADR-022 explicitly declined to
  carve an exception even where it would have been easy; ADR-031's browser-direct Home
  Assistant path is the one deliberate, argued exception.
- The API is on the critical path of every widget — NFR-2's 200 ms p95 read budget and NFR-4's
  per-widget failure isolation are what make that acceptable.
- More code than Supabase-direct for plain CRUD: every table gets a controller/service/
  repository even when PostgREST would have sufficed. Accepted — that code is where the
  learning and the single authorization point live.

## Alternatives considered

- **Full "Supabase as backend"** (PostgREST + RLS + edge functions, no NestJS) — least code
  and least hosting, but authorization becomes SQL-policy programming, cross-domain logic
  scatters into edge functions, and the NestJS learning goal is gutted. Rejected.
- **Mixed access per widget** (simple reads direct to Supabase, writes and Mongo through the
  API) — each widget takes its cheapest path, but produces two client data layers, duplicated
  ACL logic, and per-widget security review forever. Rejected: the uniform rule is worth more
  than the saved hops.
- **API-only including auth and realtime** — maximal uniformity, but re-proxying Supabase's
  auth protocol and websockets adds real complexity to replace infrastructure that RLS already
  secures. Rejected: the two carve-outs are precisely the places Supabase's enforcement is
  native.
