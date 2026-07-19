# Command Center

Personal dashboard: learning (Japanese + tech micro-lessons), tasks, automations,
mood tracking, and journaling — one customizable widget grid.

Architecture: [docs/ADR.md](docs/ADR.md) · ADRs: [docs/adr/](docs/adr/)

## Stack

- **apps/web** — Next.js (App Router, RSC) on Vercel; dashboard shell + widgets
- **apps/api** — NestJS modular monolith (API + worker entrypoints)
- **packages/contracts** — shared zod schemas (end-to-end types FE↔BE)
- **packages/ui** — widget SDK (widget contract, registry, error boundaries)
- Supabase (auth + Postgres + RLS) · MongoDB Atlas (braindump + document-shaped modules)

## Quickstart (target: ≤ 15 min, NFR-9)

```bash
corepack enable pnpm       # or: npm i -g pnpm

bash scripts/setup-env.sh  # creates apps/web/.env.local + apps/api/.env
# → fill in the Supabase URL + anon key (see docs/ENV_SETUP.md)
# → run supabase/migrations/*.sql in the Supabase SQL editor

pnpm dev                   # web on :3000, api on :3001
```

Other commands: `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e`

`pnpm test:e2e` runs the API suite (supertest + mongodb-memory-server + stubbed
JWT verifier; hermetic) and the web suite (Playwright; the authed dashboard flow
needs `E2E_EMAIL`/`E2E_PASSWORD` and a running API).

## Current state

Phase 0 (monorepo, CI, auth end-to-end, dashboard shell + widget registry) is
done, Phase 1 is underway, and the Phase 2 automations backend has landed
(ADR-039: reminders fired by an inline scheduler tick behind an external
pinger — no worker process, no queue; Web Push + in-app notification bell).
Widgets so far: clock, braindump, tasks, mood. Braindump is the first
MongoDB-backed module; everything else lives in Supabase Postgres
(`supabase/migrations/`). One-time Phase 2 external setup:
[docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md). See ADR §9 for Phases 1–4.

Design decisions are recorded as ADRs under `docs/adr/` in domain subfolders
(foundation / productivity / reflection / learning / external-data / lifestyle),
indexed in [docs/adr/README.md](docs/adr/README.md).

## Widget roadmap

Each life area arrives as widgets on the shared grid — addable, removable,
reorderable, customizable, all following the same contract (title, content,
quick actions, settings):

- **Learning** — Japanese word of the day, grammar points, Anki sync; daily
  Java/SQL/TypeScript/React micro-lessons with streaks and "Add to Anki"
- **Productivity** — todo list (priorities, tags, deadlines, recurrence),
  braindump, calendar (daily/weekly/monthly)
- **Automation** — time-based and repeating triggers, smart reminders
  (e.g., "after finishing a task")
- **Reflection** — mood checker (sliders, tags, trends), appreciation tracker,
  journaling (prompts, rich text, search, timeline)
- **Future** — habits, Pomodoro, fitness & health, finance, Home Assistant
