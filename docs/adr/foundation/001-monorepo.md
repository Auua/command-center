# ADR-001: Monorepo (pnpm + Turborepo)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

Command Center is one product with two runtimes: a Next.js frontend and a NestJS backend
(API + worker entrypoints), plus shared code that both sides must agree on — request/response
schemas, widget SDK types, lint/tsconfig presets. The project is built and maintained by one
person; a feature almost always spans both sides (a widget's UI and its API module land
together), and the FE↔BE contract is the seam most likely to drift silently. Goals G2 (low
operational burden) and G4 (extensible widget contract) both push toward a setup where one
change set can touch every affected layer and one CI run validates all of it.

## Decision

We will keep the whole system in a single repository managed by **pnpm workspaces** with
**Turborepo** as the task runner:

```
command-center/
├── apps/
│   ├── web/            # Next.js
│   └── api/            # NestJS (API + worker entrypoints)
├── packages/
│   ├── contracts/      # zod schemas + generated API client types (shared FE/BE)
│   ├── ui/             # shared UI primitives + widget SDK
│   └── config/         # eslint, tsconfig, prettier presets
└── docs/               # architecture reference, ADRs, runbooks
```

- **`packages/contracts` is the type seam.** Every wire shape is a zod schema defined once and
  imported by both `apps/api` (validation at the door) and `apps/web` (parsing responses) — the
  end-to-end type-safety mechanism that makes REST viable without tRPC (ADR-007).
- **Internal dependencies use `workspace:*`**, so packages always consume each other's current
  source; no internal publishing, no version-range matrix.
- **Turborepo owns the task graph**: `build` depends on `lint` and `typecheck`, tasks are cached
  per package, and CI/pre-commit run the same graph (`pnpm build`, `pnpm test`) with `--filter`
  for scoped runs.
- **One lockfile, one CI pipeline, one PR** for any change, however many packages it touches.

## Consequences

- End-to-end type safety is structural: an API shape change breaks the web build in the same PR
  that made it, not in a consumer repo weeks later.
- Every task-shape change touches `packages/contracts` first — deliberate friction that keeps
  the contract explicit (ADR-008 leans on this).
- Tooling (TypeScript, ESLint, Prettier versions) is unified in `packages/config`; there is
  exactly one answer to "which config applies".
- The commit gate covers the whole workspace, so an unrelated package's failure can block a
  commit — accepted; turbo caching keeps the cost low, and a red anywhere is worth knowing.
- Turborepo's task-dependency indirection is a small learning cost of its own: a "build failure"
  may actually be a lint/format failure surfaced through the task graph (documented in
  CLAUDE.md).

## Alternatives considered

- **Two repositories (web / api)** — the conventional split. Rejected: the shared contract
  would need publishing or copying, and drifts either way; every feature becomes two PRs and
  two CI runs; setup cost doubles for a one-person project that gains nothing from independent
  release cadence.
- **pnpm workspaces without Turborepo** — fewer moving parts, but no task graph or caching;
  `build`-depends-on-`lint`/`typecheck` ordering and per-package cache hits would be hand-rolled
  scripts. Rejected for the task runner's leverage at near-zero config.
- **Nx** — richer than Turborepo (generators, project graph, module-boundary lint out of the
  box), but heavier and more opinionated than a five-package workspace needs. Rejected;
  boundary enforcement is handled with plain ESLint rules instead (ADR-002).
- **Publishing `contracts` as a versioned npm package** — real versioning discipline, but a
  release step between "change the schema" and "use the schema" is exactly the friction a
  personal project abandons things over. Rejected.
