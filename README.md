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

# Command Center — Personal Dashboard

## Overview

Command Center is your all‑in‑one personal dashboard: a single place to track learning, automate your day, manage tasks, reflect on your mood, and journal. It brings together multiple widgets—each focused on a different part of your life—into one cohesive, customizable interface.

## Tech Stack

- NextJS + TypeScript (Vercel)
- Modular backend services using NestJS + TypeScript
- Supabase + MongoDB integrations

## Learning Modules

### Japanese Learning

- Word of the Day — daily vocabulary with reading, meaning, and usage
- Grammar Point — bite‑sized grammar explanations with example sentences
- Anki Integration — sync decks, track reviews, and show spaced‑repetition stats

### Tech Learning

Daily micro‑lessons to keep your skills sharp:

- Java of the Day — snippet, concept, or pattern
- SQL of the Day — query patterns, joins, indexing tips
- TypeScript of the Day — typing tricks, utility types, patterns
- ReactJS of the Day — hooks, components, patterns
- Extendable with Python, Rust, DevOps, algorithms, etc.

Each learning widget supports:

- Progress tracking
- Streaks
- Quick notes
- “Add to Anki” button

## Productivity & Organization

### Todo List

A simple but powerful task manager with:

- Priorities
- Tags
- Deadlines
- Quick‑add shortcuts
- Recurring events

### Braindump

A frictionless space to dump ideas, thoughts, and reminders.

### Calendar

Daily, weekly, and monthly views integrated with your tasks and automations.

## Automation & Notifications

### Daily Triggers

Create custom automations to remind you about:

- Learning tasks
- Mood check‑ins
- Journaling
- Hydration
- Breaks
- Anything else you want to remember

Supports:

- Time‑based triggers
- Repeating schedules
- Smart reminders (e.g., “after finishing a task”)

## Mood & Reflection

### Mood Checker

Track your emotional state throughout the day with:

- Mood sliders
- Tags (stress, energy, focus)
- Notes
- Trends over time

### Appreciation Tracker

Record small wins, gratitude moments, and positive events.

## Journaling

### Journal

A clean, distraction‑free writing space with:

- Daily prompts
- Rich text
- Search
- Tags
- Timeline view

## Architecture & Widget System

Widgets are modular and can be:

- Added
- Removed
- Reordered
- Customized

Each widget follows a consistent structure:

- Title
- Content area
- Quick actions
- Settings

## Future Extensions

- Habit tracking
- Pomodoro timer
- Fitness & health widgets
- Finance dashboard
- Home Assistant integration
