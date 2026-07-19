# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Reference

`docs/ADR.md` is the authoritative architecture document — read it before making structural decisions. It defines the container layout (Next.js on Vercel + NestJS modular monolith; the worker entrypoint remains a Phase-0 stub), the widget SDK contract, the Postgres/MongoDB data-ownership split, the automation delivery design (inline tick behind an external pinger, ADR-039 — pg-boss/worker deferred), security model incl. the scheduler-only service-role carve-out, NFR targets, delivery phasing (§9), and summary rows for every ADR.

The foundational ADRs 001–007 live in `docs/adr/foundation/`; per-widget and domain decisions live as ADRs 008+ in domain subfolders of `docs/adr/` (productivity / reflection / learning / external-data / lifestyle). A new load-bearing decision gets an ADR from `docs/adr/template.md` in the fitting subfolder, a row in the `docs/adr/README.md` index, and a summary row in the ADR. ADR numbering is global across folders; `docs/adr/REVIEW-QUEUE.md` tracks the acceptance walkthrough. Keep ADR/ADR prose impersonal — "the user" / "the product owner", no personal names.

## Current State

Phase 0 (skeleton) is done, Phase 1 is underway, and the Phase 2 (automations MVP, ADR-039) backend has landed: pnpm + Turborepo monorepo with `apps/web` (Next.js App Router), `apps/api` (NestJS API + worker entrypoints), and `packages/{contracts,ui,config}`. Auth (Supabase JWT → NestJS guard), the dashboard shell with widget registry, and four widgets exist: clock, braindump, tasks, mood.

Phase 2 API modules: `profile/` (GET/PUT `/profile`, stored IANA timezone), `automation/` (CRUD + `/automations/today` + templates + runs; `schedule` jsonb compiled server-side to `cron_expr`; pure schedule core under `automation/schedule/`), `notification/` (push subscriptions + notification bell + WebPushService), `scheduler/` (secret-guarded `POST /internal/tick` — the API's second non-JWT route — cursor/claim/dispatch pipeline; its repository is the ONLY service-role Supabase consumer). The tick is driven by an external pinger (cron-job.org); one-time external setup is scripted in `docs/PHASE2_SETUP.md`. No pg-boss, no `DATABASE_URL`; `dist/worker` stays the Phase-0 heartbeat stub.

Data split so far: braindump is MongoDB-backed (`braindump_notes` collection); widget layouts, tasks, mood check-ins, user profiles, automations + runs, push subscriptions, notifications, and scheduler state are Supabase Postgres (`supabase/migrations/0001`–`0007`, applied manually via the SQL editor). Each API domain module lives under `apps/api/src/<module>`, each widget under `apps/web/widgets/<name>` and is registered in `apps/web/widgets/registry.ts`.

## Commands (run from repo root)

- `pnpm install` — install workspace deps
- `pnpm dev` — run everything via Turborepo (web on :3000, api on :3001)
- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` — per-package via Turborepo; scope with `--filter`, e.g. `pnpm --filter @command-center/api test`
- Single test: API (jest) `pnpm --filter @command-center/api test -- braindump`; web (vitest) `pnpm --filter @command-center/web test -- registry`
- `pnpm test:e2e` — API e2e (supertest + mongodb-memory-server + stubbed JWT verifier; hermetic) and web e2e (Playwright; unauthenticated tier always runs, the authed dashboard flow runs only with `E2E_EMAIL`/`E2E_PASSWORD` set and the API running)
- `pnpm --filter @command-center/api start:worker` — run the worker process (built entrypoint `dist/worker`; still the Phase-0 heartbeat stub)
- Env setup: `bash scripts/setup-env.sh`, then see `docs/ENV_SETUP.md` (`apps/web/.env.local`, `apps/api/.env`). Phase 2 adds `SUPABASE_SECRET_KEY`, `TICK_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (fail-fast; generation documented there). Tests need no real values.
- Local tick: `curl -X POST localhost:3001/api/v1/internal/tick -H "x-tick-secret: $TICK_SECRET"` — never against prod DB/VAPID keys (dev rule, `docs/ENV_SETUP.md`); one-time production setup (migrations, Vercel env, cron-job.org, UptimeRobot) is `docs/PHASE2_SETUP.md`

Note `turbo build` depends on `lint` and `typecheck`, and `lint` runs Prettier via the root `format` task — a build failure may actually be a lint/format failure.

## Commit Rules

Every commit must pass lint, typecheck, tests, and build. The Husky pre-commit hook (`.husky/pre-commit`) enforces this: it runs `lint-staged` (Prettier on staged files), `pnpm build` (which covers `lint` and `typecheck` via Turborepo task deps), and `pnpm test`. Don't run these manually before committing — the hook is the single runner, and `build`/`test` are turbo-cached anyway. If the hook fails, the commit aborts: fix the failure and commit again. Never bypass the hook (`HUSKY=0`, `--no-verify`) except when the user explicitly asks.

Prepare each commit so it lands complete:

1. **Bump versions** — bump `version` (semver) in the `package.json` of every workspace package the commit touches. Internal deps use `workspace:*`, so no cross-package version references need editing.
2. **Update dependencies where affected** — if the commit adds/changes a package's exports or peer requirements, update the `package.json` of consuming workspace packages accordingly and re-run `pnpm install` so the lockfile is committed in sync.
3. **Update docs where the change is used** — keep `CLAUDE.md` (Current State, Commands), `README.md`, `docs/ENV_SETUP.md`, and any affected ADRs in step with the change; new load-bearing decisions get an ADR per the Architecture Reference section above.

Include the version bumps, lockfile, and doc updates in the same commit as the change they describe.

## What This Project Is

Command Center is a personal dashboard composed of modular widgets covering:

- **Learning** — Japanese (word of the day, grammar, Anki integration) and daily tech micro-lessons (Java/SQL/TypeScript/React "of the day"), with progress tracking, streaks, and an "Add to Anki" action
- **Productivity** — todo list (priorities, tags, deadlines, recurrence), braindump, calendar (daily/weekly/monthly views)
- **Automation** — time-based and repeating triggers/reminders, including smart reminders (e.g., "after finishing a task")
- **Reflection** — mood checker (sliders, tags, trends), appreciation tracker, journaling (prompts, rich text, search, tags, timeline)

### Widget System

Widgets are the core architectural unit. They are modular — addable, removable, reorderable, and customizable — and each follows a consistent structure: title, content area, quick actions, and settings. New features (habit tracking, Pomodoro, fitness, finance, Home Assistant) are expected to arrive as new widgets, so keep widget contracts consistent and self-contained.
