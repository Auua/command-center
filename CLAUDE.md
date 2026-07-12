# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Reference

`docs/ARD.md` is the authoritative architecture document — read it before making structural decisions. It defines the container layout (Next.js on Vercel + NestJS modular monolith with a separate worker process), the widget SDK contract, the Postgres/MongoDB data-ownership split, the automation/queue design (pg-boss), security model, NFR targets, and ADRs 001–007. New load-bearing decisions get an ADR in `docs/adr/` (template there) and a summary row in the ARD.

## Current State

Phase 0 (skeleton) and the start of Phase 1 are in place: pnpm + Turborepo monorepo with `apps/web` (Next.js), `apps/api` (NestJS API + worker entrypoints), and `packages/{contracts,ui,config}`. Auth (Supabase JWT → NestJS guard), the dashboard shell with widget registry, and the first widgets (clock, braindump) exist. Braindump is the first MongoDB-backed module (`braindump_notes` collection).

### Commands (run from repo root)

- `pnpm install` — install workspace deps
- `pnpm dev` — run everything via Turborepo (web on :3000, api on :3001)
- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` — per-package via Turborepo; scope with `--filter`, e.g. `pnpm --filter @command-center/api test`
- `pnpm test:e2e` — API e2e (supertest + mongodb-memory-server + stubbed JWT verifier; hermetic) and web e2e (Playwright; unauthenticated tier always runs, the authed dashboard flow runs only with `E2E_EMAIL`/`E2E_PASSWORD` set and the API running)
- Env setup: `bash scripts/setup-env.sh`, then see `docs/ENV_SETUP.md` (`apps/web/.env.local`, `apps/api/.env`)

## What This Project Is

Command Center is a personal dashboard composed of modular widgets covering:

- **Learning** — Japanese (word of the day, grammar, Anki integration) and daily tech micro-lessons (Java/SQL/TypeScript/React "of the day"), with progress tracking, streaks, and an "Add to Anki" action
- **Productivity** — todo list (priorities, tags, deadlines), braindump, calendar (daily/weekly/monthly views)
- **Automation** — time-based and repeating triggers/reminders, including smart reminders (e.g., "after finishing a task")
- **Reflection** — mood checker (sliders, tags, trends), appreciation tracker, journaling (prompts, rich text, search, tags, timeline)

## Planned Architecture (from README)

- **Frontend:** Next.js + TypeScript, deployed on Vercel
- **Backend:** modular services built with NestJS + TypeScript
- **Data:** both Supabase and MongoDB integrations

### Widget System

Widgets are the core architectural unit. They are modular — addable, removable, reorderable, and customizable — and each follows a consistent structure: title, content area, quick actions, and settings. New features (habit tracking, Pomodoro, fitness, finance, Home Assistant) are expected to arrive as new widgets, so keep widget contracts consistent and self-contained.
