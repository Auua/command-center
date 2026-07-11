# Command Center

Personal dashboard: learning (Japanese + tech micro-lessons), tasks, automations,
mood tracking, and journaling — one customizable widget grid.

Architecture: [docs/ARD.md](docs/ARD.md) · ADRs: [docs/adr/](docs/adr/)

## Stack

- **apps/web** — Next.js (App Router, RSC) on Vercel; dashboard shell + widgets
- **apps/api** — NestJS modular monolith (API + worker entrypoints)
- **packages/contracts** — shared zod schemas (end-to-end types FE↔BE)
- **packages/ui** — widget SDK (widget contract, registry, error boundaries)
- Supabase (auth + Postgres + RLS) · MongoDB Atlas (Phase 1+)

## Quickstart (target: ≤ 15 min, NFR-9)

```bash
corepack enable pnpm       # or: npm i -g pnpm
npm install -g pnpm

bash scripts/setup-env.sh  # creates apps/web/.env.local + apps/api/.env
# → fill in the Supabase URL + anon key (see docs/ENV_SETUP.md)
# → run supabase/migrations/*.sql in the Supabase SQL editor

pnpm dev                   # web on :3000, api on :3001
```

Other commands: `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test`

## Delivery phases

Phase 0 (this) proves the whole pipe: monorepo, CI, auth end-to-end, dashboard
shell + widget registry, clock widget. See ARD §9 for Phases 1–4.
