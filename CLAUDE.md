# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Reference

`docs/ARD.md` is the authoritative architecture document — read it before making structural decisions. It defines the container layout (Next.js on Vercel + NestJS modular monolith with a separate worker process), the widget SDK contract, the Postgres/MongoDB data-ownership split, the automation/queue design (pg-boss), security model, NFR targets, and ADRs 001–007. New load-bearing decisions get an ADR in `docs/adr/` (template there) and a summary row in the ARD.

## Current State

This is a greenfield project: the repository currently contains only the README, LICENSE, and a Node-oriented .gitignore. There is no application code, package.json, or build/test tooling yet. When scaffolding begins, update this file with the actual build, lint, and test commands.

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
