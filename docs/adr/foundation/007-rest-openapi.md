# ADR-007: REST + OpenAPI-generated typed client (not GraphQL, not tRPC)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

The frontend needs a typed way to talk to the backend. The API has exactly one consumer — the
dashboard — and both ends are TypeScript in one repo (ADR-001), which makes the strongest
argument for tRPC (end-to-end types without a schema step) and the strongest argument for
GraphQL (many consumers with divergent data needs) both weaker than usual. NestJS's native
idiom is REST controllers with decorator-driven OpenAPI generation; the API surface is also a
learning artifact (G3), and REST + OpenAPI is the industry-transferable skill.

## Decision

We will expose the backend as **versioned REST** (`/api/v1`) with **OpenAPI generated from
NestJS decorators**, and close the type gap with two mechanisms:

- **Shared zod schemas in `packages/contracts`** define every wire shape once. The API parses
  request bodies with them (`.strict()`, reject-unknown-fields — §5.2); the web client parses
  responses with the _same_ schemas, so neither end trusts the wire (ADR-008 is the reference
  implementation of this pattern).
- **A typed client generated from the OpenAPI spec** gives the frontend callable, typed
  endpoints; widgets consume it through hooks in `packages/contracts`, never raw `fetch`.

Conventions that ride on this: resource-oriented URLs per domain module (`/api/v1/tasks`,
`/api/v1/mood/…`), standard verb semantics (PATCH partial updates, 204 deletes, 404 for
foreign-or-missing ids with no existence oracle), and `/api/v1` as the compatibility line —
breaking changes mean `/api/v2`, not silent mutation.

## Consequences

- The FE↔BE seam is typed twice over — statically by the generated client, and at runtime by
  zod at both edges — so contract drift fails loudly on whichever side moved.
- The OpenAPI spec is a real artifact: browsable API docs for free, and any future non-TS
  consumer (a phone shortcut, a script) gets a standard machine-readable contract — tRPC would
  have priced that out.
- Codegen is a build step: schema changes flow contracts → spec → client, and the monorepo
  task graph (ADR-001) is what keeps that loop tight enough not to hurt.
- REST's fixed response shapes mean widgets occasionally over- or under-fetch relative to a
  GraphQL ideal; at one-consumer scale the fix is editing the endpoint, which costs one PR.
- Per-endpoint REST fits the per-widget failure model (§4.5): each widget hydrates from its
  own endpoints, so one failing endpoint is one fallback card, never a shared-query blast
  radius.

## Alternatives considered

- **tRPC** — best-in-class DX for exactly this setup (TS both ends, one repo), no codegen
  step. Rejected: it couples the frontend to NestJS internals through router type inference,
  fights NestJS idiom (controllers, decorators, pipes) instead of using it, produces no
  standard spec for non-TS consumers, and removes the REST/OpenAPI learning value. The
  contracts package delivers most of tRPC's safety anyway.
- **GraphQL** — one flexible endpoint, precise per-widget queries. Rejected: resolver/schema
  machinery, N+1 discipline, and caching complexity are overkill for a single first-party
  consumer; NestJS supports it, but everything it buys here REST already provides at lower
  cost.
- **REST without a generated client** (hand-written fetch + shared zod only) — fewer build
  steps and runtime safety would still hold, but endpoint paths/params/verbs stay stringly
  typed and drift silently. Rejected: the generator closes exactly that gap.
