# Command Center — Architecture Reference Document (ADR)

|              |                                                                         |
| ------------ | ----------------------------------------------------------------------- |
| **Status**   | Draft v0.1                                                              |
| **Date**     | 2026-07-11                                                              |
| **Scope**    | Full system: frontend, backend services, data, automation, integrations |
| **Audience** | Project owner + future contributors (human or AI)                       |

---

## 1. Introduction

### 1.1 Purpose

Command Center is a personal dashboard: a single place to track learning (Japanese + tech micro-lessons), manage tasks, run daily automations/reminders, track mood, and journal. This document records the target architecture, the reasoning behind it, and the non-functional requirements it must satisfy.

### 1.2 Goals

- **G1 — One cohesive surface.** All widgets live in one customizable dashboard; adding a new life-area never requires touching another widget.
- **G2 — Low operational burden.** This is a personal project; it must survive weeks of neglect. Managed services over self-hosted, boring tech over novel.
- **G3 — Learning vehicle.** The stack (Next.js, NestJS, Supabase, MongoDB) is deliberately chosen to build skills; some redundancy (two databases) is accepted for that reason and contained by design.
- **G4 — Extensible widget contract.** Future widgets (habits, Pomodoro, fitness, finance, Home Assistant) plug in without core changes.

### 1.3 Non-Goals (v1)

- Multi-tenant SaaS. Built single-user first, but auth and data models are user-scoped from day one so multi-user is a config change, not a rewrite.
- Native mobile apps. Responsive web + PWA (installable, push notifications) covers mobile.
- Offline-first sync. Optimistic UI yes; full CRDT-style offline sync no.
- Real-time collaboration.

---

## 2. System Context (C4 Level 1)

```mermaid
flowchart TB
    user(["👤 Product owner<br/>(single user)"])

    subgraph cc ["Command Center"]
        system["Command Center<br/>Personal dashboard:<br/>learning · tasks · automations · mood · journal"]
    end

    anki["AnkiWeb<br/>(synced by the learning repo's<br/>GitHub Action, ADR-026)"]
    learnrepo["GitHub learning-center repo<br/>(word pool · cards · progress ·<br/>sync state, ADR-024)"]
    push["Web Push service<br/>(browser vendor endpoints)"]
    supabase[("Supabase<br/>Auth + Postgres + Realtime")]
    mongo[("MongoDB Atlas<br/>Document store")]
    content["Content sources<br/>(dictionary/lesson APIs,<br/>seeded datasets)"]
    gcal["Google Calendar API<br/>(OAuth, per-calendar<br/>read-only / read-write)"]

    user -->|"HTTPS / PWA"| system
    system -->|"Contents API (fine-grained PAT):<br/>pool reads, card/progress writes"| learnrepo
    learnrepo -->|"Action: official anki library<br/>sync (never full-upload)"| anki
    system -->|"scheduled reminders"| push
    push -->|"notifications"| user
    system --> supabase
    system --> mongo
    system -->|"fetch word/grammar/lesson data"| content
    system -->|"10-min incremental sync,<br/>write-through edits"| gcal
```

**External dependencies and their failure posture:**

| Dependency                | Used for                                      | If unavailable                                                                                                                                                            |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase                  | Auth, relational data, realtime               | App unusable (accepted single point of failure)                                                                                                                           |
| MongoDB Atlas             | Documents (journal, braindump, content)       | Affected widgets show error state; rest of dashboard works                                                                                                                |
| GitHub (learning repo)    | Word pool, cards, progress, Anki sync trigger | API serves cached pool (stale word; cold boot mid-outage → "try again later"); saves error with visible retry; an Actions outage delays sync, loses nothing (ADR-024/026) |
| AnkiWeb (via repo Action) | Deck sync, review stats                       | Sync delayed, never lost — cards wait in the repo; widget shows the honest waiting/failed state from `sync/state.json` (ADR-026)                                          |
| Web Push                  | Reminders                                     | Automations still logged in-app; notification bell as fallback                                                                                                            |
| Content APIs              | Word/lesson of the day                        | Serve from pre-seeded content cache                                                                                                                                       |
| Google Calendar           | Synced calendars (mirror, write-through)      | Mirror serves stale (labelled "synced N min ago"); writes fail visibly; `needs_reauth` banner on token failure (ADR-037)                                                  |

---

## 3. High-Level Architecture (C4 Level 2 — Containers)

```mermaid
flowchart TB
    user(["👤 User"])

    subgraph vercel ["Vercel"]
        web["Next.js App (TS)<br/>App Router · RSC · PWA<br/>Dashboard shell + widgets"]
        api["NestJS API (TS)<br/>Modular monolith<br/>REST + OpenAPI"]
        worker["NestJS Worker<br/>(same codebase, worker entrypoint)<br/>Scheduler · queues · push dispatch"]
    end

    subgraph data ["Managed data"]
        sb[("Supabase<br/>Postgres + Auth + RLS")]
        mg[("MongoDB Atlas")]
        q[("Job queue<br/>(pg-boss on Supabase Postgres)")]
    end

    user -->|HTTPS| web
    web -->|"REST /api/v1 (JWT)"| api
    web -.->|"Auth flows + realtime subscriptions only"| sb
    api --> sb
    api --> mg
    api -->|enqueue| q
    worker -->|consume| q
    worker --> sb
    worker --> mg
    worker -->|"Web Push (VAPID)"| user
```

### 3.1 Container responsibilities

**Next.js app (Vercel)**

- Dashboard shell: widget grid, layout persistence, theming, quick actions.
- Talks to the NestJS API for all domain reads/writes (single API surface, versioned `/api/v1`).
- Talks to Supabase **directly only** for: auth flows (sign-in, session refresh) and realtime subscriptions (e.g., live task updates). Everything else goes through the API — this keeps authorization logic in one place.
- Server Components for initial dashboard render (fast first paint); client components + TanStack Query for widget interactivity.

**NestJS API (modular monolith)**

- One deployable, strict module boundaries (see §4). "Modular backend services" from the README is realized as _modules inside one process_ until scale or isolation demands extraction — see ADR-002.
- Validates Supabase-issued JWTs; owns all authorization decisions.
- OpenAPI spec generated from decorators; the frontend consumes a generated typed client.

**NestJS Worker**

- Same repo/codebase, separate entrypoint and process. Runs cron evaluation for automations, consumes queued jobs (push dispatch, streak rollover, content prefetch). Anki sync is not a worker job — it runs as a GitHub Action in the learning repo (ADR-026).
- Kept separate from the API process so a stuck job never blocks interactive requests.

### 3.2 Repository & code organization

Monorepo (pnpm workspaces + Turborepo) — see ADR-001:

```
command-center/
├── apps/
│   ├── web/            # Next.js
│   └── api/            # NestJS (API + worker entrypoints)
├── packages/
│   ├── contracts/      # zod schemas + generated API client types (shared FE/BE)
│   ├── ui/             # shared UI primitives + widget SDK
│   └── config/         # eslint, tsconfig, prettier presets
└── docs/               # this ADR, ADRs, runbooks
```

---

## 4. Mid-Level Design

### 4.1 Backend module decomposition (NestJS)

```mermaid
flowchart LR
    subgraph core ["Core (cross-cutting)"]
        auth["AuthModule<br/>JWT guard, user context"]
        notif["NotificationModule<br/>push subscriptions, dispatch"]
        sched["AutomationModule<br/>triggers, schedules, rules"]
        widgets["WidgetRegistryModule<br/>layout, per-widget settings"]
    end

    subgraph domains ["Domain modules"]
        learn["LearningModule<br/>learning repo (WOTD, grammar, cards),<br/>lessons, streaks"]
        tasks["TasksModule<br/>todos, priorities, tags"]
        cal["CalendarModule"]
        mood["MoodModule<br/>check-ins, trends"]
        journal["JournalModule<br/>entries, prompts, search"]
        brain["BraindumpModule"]
    end

    sched -->|"emits domain events<br/>(task.completed, day.rolled)"| notif
    tasks -->|events| sched
    learn -->|events| sched
```

**Module rules (enforced via ESLint boundaries):**

- Domain modules never import each other directly; cross-domain reactions go through an in-process event bus (`@nestjs/event-emitter`). Example: `TasksModule` emits `task.completed`; `AutomationModule` listens and evaluates "after finishing a task" smart reminders.
- Each module owns its persistence — no shared repositories across modules. This is what makes later extraction to a real service cheap (ADR-002).
- Every module exposes: REST controller(s), a service layer, and optionally event handlers. Controllers are thin; rules live in services.

### 4.2 Frontend widget system

The widget contract is the core extensibility mechanism (G4):

```typescript
// packages/ui — widget SDK (illustrative)
interface WidgetDefinition<TSettings = unknown> {
  id: string; // "japanese-word", "todo", "mood"
  title: string;
  sizes: WidgetSize[]; // grid footprints it supports
  component: React.ComponentType<WidgetProps<TSettings>>;
  settingsSchema: z.ZodType<TSettings>; // drives the auto-generated settings panel
  quickActions?: QuickAction[]; // rendered in the widget chrome
}
```

- **Registry pattern:** widgets self-register into a client-side registry; the dashboard shell renders from the user's persisted layout (widget id + position + size + settings). Adding a widget = adding one folder under `apps/web/widgets/` + one registry entry.
- **Isolation:** each widget gets an error boundary and its own suspense boundary — a broken widget renders a fallback card, never a blank dashboard.
- **Data:** widgets fetch through hooks in `packages/contracts` (generated from OpenAPI). No widget talks to Supabase/Mongo directly.
- **Layout persistence:** grid layout stored per-user via `WidgetRegistryModule` (Postgres, JSONB column for settings).

### 4.3 Data architecture — who owns what

Two databases is a deliberate (learning-driven) choice — the split is by data shape, and each collection/table has exactly one owner module:

| Store                 | Data                                                                                                                                                                | Why here                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Supabase Postgres** | users/profiles, tasks, calendar events, mood check-ins, streaks & progress counters, automations/triggers, push subscriptions, widget layouts, appreciation entries | Relational, queried with filters/aggregations (trends, streaks), benefits from RLS, realtime |
| **MongoDB Atlas**     | journal entries (rich text as structured JSON), braindump notes                                                                                                     | Document-shaped, schema-flexible content, full-text search (Atlas Search) for journal        |

**Rules:**

- No cross-database joins. If a widget needs both (e.g., journal entry linked to a mood check-in), the API composes; references are stored as opaque IDs.
- Mongo is **never** exposed to the client; access only via the API.
- If dual-DB operational cost outweighs learning value, the fallback is folding Mongo collections into Postgres JSONB — the one-owner-per-collection rule keeps that migration scoped (ADR-003).

### 4.4 Core data model (Postgres)

```mermaid
erDiagram
    users ||--o{ tasks : owns
    users ||--o{ mood_checkins : owns
    users ||--o{ automations : owns
    users ||--o{ widget_layouts : owns
    users ||--o{ streaks : owns
    users ||--o{ streak_days : owns
    users ||--o{ push_subscriptions : owns
    users ||--o{ calendar_events : owns
    users ||--o{ calendar_accounts : owns
    calendar_accounts ||--o{ calendar_sources : lists
    calendar_sources ||--o{ calendar_events : mirrors
    automations ||--o{ automation_runs : logs

    tasks {
        uuid id PK
        uuid user_id FK
        text title
        int priority "1 highest .. 3, null = none"
        text[] tags
        date deadline
        timestamptz completed_at
        text rrule "nullable; recurring series rule (ADR-036)"
        jsonb repeat "structured descriptor; edit UI source"
        uuid series_id "lineage key; one open occurrence per series"
        uuid spawned_from "FK tasks(id); which completion spawned this row"
    }
    mood_checkins {
        uuid id PK
        uuid user_id FK
        int mood_score
        text[] tags "stress, energy, focus"
        text note
        timestamptz created_at
    }
    automations {
        uuid id PK
        uuid user_id FK
        text kind "time | recurring | event"
        text cron_expr "nullable"
        text event_key "e.g. task.completed"
        jsonb action "notify payload"
        bool enabled
    }
    automation_runs {
        uuid id PK
        uuid automation_id FK
        timestamptz fired_at
        text status "sent | failed | skipped"
    }
    streaks {
        uuid id PK
        uuid user_id FK
        text widget_id "japanese-wotd, tech-lesson:{track}, habit:{key}… UNIQUE(user_id, widget_id)"
        int current_len
        int best_len
        date last_active_date
        timestamptz updated_at
    }
    streak_days {
        uuid user_id PK
        text streak_key PK "matches streaks.widget_id"
        date local_date PK "home-tz day, 03:00 grace (ADR-014)"
    }
    widget_layouts {
        uuid id PK
        uuid user_id FK
        text widget_id
        jsonb grid_pos
        jsonb settings
    }
    calendar_events {
        uuid id PK
        uuid user_id FK
        text title
        timestamptz starts_at "timed events; null when all-day (ADR-018)"
        date starts_on "all-day events; CHECK one representation"
        text rrule "nullable RFC 5545 series"
        uuid source_id FK "nullable; null = own event (ADR-037)"
        text external_id "UNIQUE(source_id, external_id), with etag"
    }
    calendar_accounts {
        uuid id PK
        uuid user_id FK
        text provider "google"
        bytea refresh_token_enc "AES-256-GCM at rest (ADR-037)"
        text status "ok | needs_reauth"
    }
    calendar_sources {
        uuid id PK
        uuid user_id FK
        uuid account_id FK
        text google_calendar_id
        text mode "read | write"
        text sync_token "nullable; incremental sync cursor"
        timestamptz last_synced_at
    }
```

MongoDB collections (owner module in parens): `journal_entries` (Journal), `braindump_notes` (Braindump). All documents carry `userId` and are filtered on it in every query via a repository base class. Learning-center data (word pool, authored grammar points, tech lessons, saved cards, per-kind progress, Anki sync state) is deliberately **not** in either database — it lives as files in the private GitHub learning repo (ADR-024; `jp_content` and `lesson_content` were retired unbuilt when grammar and tech lessons moved there, ADR-012/013 — **Mongo's learning tenancy is zero**).

### 4.5 Key flows

**Dashboard load:**

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as Next.js (RSC)
    participant A as NestJS API
    participant P as Postgres
    B->>W: GET /
    W->>A: GET /api/v1/layout (JWT from session)
    A->>P: fetch widget_layouts
    W-->>B: shell + skeleton widgets (streamed)
    par per-widget, client-side
        B->>A: GET /api/v1/tasks?due=today
        B->>A: GET /api/v1/japanese/wotd
        B->>A: GET /api/v1/mood/today
    end
    Note over B: each widget hydrates independently;<br/>one failing endpoint = one fallback card
```

**Automation fires (time-based reminder):**

```mermaid
sequenceDiagram
    participant S as Worker (cron tick, 1/min)
    participant P as Postgres
    participant Q as pg-boss queue
    participant Push as Web Push service
    participant U as User device
    S->>P: SELECT automations due this minute<br/>(cron_expr match, enabled, tz-aware)
    S->>Q: enqueue notify jobs (idempotency key = automation_id + slot)
    Q->>S: job: dispatch
    S->>P: load push_subscriptions
    S->>Push: POST (VAPID-signed payload)
    Push-->>U: notification
    S->>P: INSERT automation_runs (status)
    Note over S,P: expired subscriptions (410) pruned on send
```

**Smart reminder ("after finishing a task"):** `TasksModule` marks task complete → emits `task.completed` → `AutomationModule` matches event-kind automations → enqueues notify job. Same tail as above.

**Anki integration (ADR-024/026):** the backend never talks to Anki, and neither does the browser. "Add to Anki" writes a card file (`anki: true` front-matter, deterministic id) into the learning-center repo; the repo's GitHub Action runs the official `anki` library against AnkiWeb — sync down, upsert notes keyed on the card id (guid `cc:<id>`), sync up (**never full-upload** — a CI runner must never overwrite mobile review history), then commit results and deck stats to `sync/state.json`, which the API reads for the status surface. AnkiWeb credentials live only in the learning repo's Actions secrets, never on our hosts.

---

## 5. Security

### 5.1 Identity & access

- **AuthN:** Supabase Auth (email + TOTP 2FA; OAuth optional later). Frontend holds the session via `@supabase/ssr` cookies (httpOnly). Every API call carries the Supabase JWT.
- **AuthZ in the API:** NestJS global guard verifies the JWT against Supabase's JWKS (asymmetric, no shared secret in the API), extracts `user_id`, and injects it into request context. **Every repository query is user-scoped** — `user_id` comes from the token, never from the request body.
- **Postgres RLS:** enabled on all tables with `user_id = auth.uid()` policies. The API connects with a role that respects RLS (not `service_role`) wherever practical, so RLS is a second net under application checks — and the only net for the client's direct realtime subscriptions.
- **Mongo:** no client access, dedicated DB user scoped to this app's database only, `userId` filter enforced in the repository base class.
- **Single-user posture:** even though v1 has one user, nothing assumes it — no "default user" fallbacks, no unauthenticated endpoints besides `/health`.

### 5.2 Application security

| Surface           | Control                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input             | zod validation at the contract layer (shared schemas) + NestJS ValidationPipe; reject-unknown-fields on                                                     |
| Journal rich text | store as structured JSON (e.g., TipTap doc), render through the editor's renderer — never `dangerouslySetInnerHTML`; sanitize on ingest as defense in depth |
| CORS              | API allows only the Vercel app origin(s)                                                                                                                    |
| Rate limiting     | `@nestjs/throttler` per-user; stricter on auth-adjacent routes                                                                                              |
| Headers           | CSP (no inline script; nonce-based), HSTS, frame-ancestors none — via Next.js middleware                                                                    |
| Secrets           | platform env vars (Vercel/Supabase dashboards); nothing in the repo; `.env.example` documents shape                                                         |
| Dependencies      | Renovate + `pnpm audit` in CI; lockfile committed                                                                                                           |
| Push payloads     | encrypted per Web Push spec (VAPID); no sensitive content in notification bodies (titles like "Mood check-in time", not journal text)                       |

### 5.3 Threat notes (STRIDE-lite, personal-app calibrated)

- **Highest-value asset:** journal + mood data — private reflections. Mitigations: 2FA, RLS, no third-party analytics on journal routes, Mongo network-restricted to backend host IPs/VPC peering where the tier allows.
- **Google Calendar refresh token (ADR-037):** same top tier — a calendar-scope token reads much of the user's life; a write-scope one can modify it. Mitigations: AES-256-GCM at rest (key in platform env), incremental scopes (read-only until a calendar is explicitly marked read-write), token never reaches the client or logs, per-calendar `mode` enforced API-side, disconnect = revoke at Google + delete credential + purge mirrored rows.
- **Tampering with automations:** automations execute only `notify` actions in v1 — no arbitrary webhooks/code — so a compromised automation record can annoy, not exfiltrate. Revisit before adding webhook actions or Home Assistant control.
- **Token theft:** short-lived access tokens (1 h), refresh rotation via Supabase; sessions revocable from the Supabase dashboard.
- **Backups as attack surface:** Atlas/Supabase managed backups inherit provider encryption at rest; no manual dump-to-laptop workflow.

---

## 6. Non-Functional Requirements

Targets calibrated for a personal, single-user system — meaningful but not enterprise theater.

| #      | Category        | Requirement                                                                                                                | Target                                                                                            |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| NFR-1  | Performance     | Dashboard first contentful paint (warm)                                                                                    | < 1.5 s p75                                                                                       |
| NFR-2  | Performance     | API reads                                                                                                                  | < 200 ms p95 per endpoint                                                                         |
| NFR-3  | Reliability     | Automation delivery                                                                                                        | fired within 60 s of schedule; at-least-once with idempotent dedupe (no double-notify per slot)   |
| NFR-4  | Availability    | Core dashboard                                                                                                             | ~99 % monthly (managed-tier reality); a failed widget never takes down the shell                  |
| NFR-5  | Durability      | Journal/mood data loss                                                                                                     | RPO ≤ 24 h (provider daily backups), RTO ≤ 1 day; quarterly restore test of both DBs              |
| NFR-6  | Security        | All traffic TLS; RLS on every Postgres table; 2FA on owner account and all provider dashboards                             | continuous                                                                                        |
| NFR-7  | Privacy         | No third-party analytics/trackers; data exportable (JSON dump endpoint per module)                                         | v1                                                                                                |
| NFR-8  | Cost            | Total monthly infra                                                                                                        | ≤ €20/mo (free/hobby tiers: Vercel Hobby, Supabase Free, Atlas M0, small backend instance)        |
| NFR-9  | Maintainability | Fresh clone → running local stack                                                                                          | ≤ 15 min (`pnpm i && pnpm dev` + documented env setup); CI: typecheck, lint, test, build < 10 min |
| NFR-10 | Observability   | Structured JSON logs; Sentry (FE+BE); `/health` per process; uptime ping (e.g., UptimeRobot) on API + worker heartbeat row | v1                                                                                                |
| NFR-11 | Accessibility   | Dashboard + widgets keyboard-navigable; WCAG 2.1 AA color contrast; respects `prefers-reduced-motion`                      | v1                                                                                                |
| NFR-12 | i18n            | UI copy externalized day one (EN first; FI/JA possible later); Japanese content rendered with proper furigana support      | v1 structure, later content                                                                       |
| NFR-13 | Portability     | No hard Vercel lock-in: Next.js standalone build + API Dockerfile both runnable anywhere                                   | continuous                                                                                        |

---

## 7. Architecture Decision Records

Full ADRs live in `docs/adr/`, grouped into domain subfolders (productivity, reflection, learning, external-data, lifestyle) with a numbered index at `docs/adr/README.md`; summaries here. ADRs 001–007 exist only as the summaries below.

| ADR     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Rationale                                                                                                                                                                                                                                                                                                                                                                                            | Alternatives rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **001** | Monorepo (pnpm + Turborepo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Shared contracts package gives end-to-end type safety FE↔BE; one PR spans both; single CI                                                                                                                                                                                                                                                                                                            | Two repos (contract drift, double setup)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **002** | NestJS **modular monolith** now; extraction path later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | One deploy target fits G2 (low ops) and NFR-8 (cost); module boundary + event-bus rules keep extraction cheap if a module ever needs isolation                                                                                                                                                                                                                                                       | Microservices day one (ops burden with zero scale need)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **003** | Dual DB with strict ownership split (§4.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Honors stack goals (G3); shape-based split is defensible; one-owner rule + no cross-DB joins contains the blast radius                                                                                                                                                                                                                                                                               | Postgres-only with JSONB (simpler — kept as documented fallback); Mongo-only (loses RLS/realtime/auth)                                                                                                                                                                                                                                                                                                                                                                    |
| **004** | All domain traffic through NestJS API; Supabase client used directly only for auth + realtime                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Single authorization point; avoids duplicated ACL logic in RLS _and_ API for writes                                                                                                                                                                                                                                                                                                                  | Full "Supabase as backend" (would gut the NestJS learning goal and scatter logic into edge functions)                                                                                                                                                                                                                                                                                                                                                                     |
| **005** | Jobs/scheduling via **pg-boss** on the existing Supabase Postgres + a worker process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Zero extra infrastructure (no Redis); transactional enqueue with domain writes; fits NFR-8                                                                                                                                                                                                                                                                                                           | BullMQ + Redis (more standard but +1 service to run/pay for); Supabase cron + edge functions (splits automation logic out of NestJS)                                                                                                                                                                                                                                                                                                                                      |
| **006** | Hosting: everything on Vercel (web + api + worker entrypoint) + managed data tiers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | One platform and one deploy pipeline; nothing needs a persistent process yet — revisit when the Phase-2 pg-boss worker lands, since a long-running queue consumer doesn't fit Vercel functions (Vercel cron or a separate host are the candidates)                                                                                                                                                   | Render/Railway/Fly.io (a second PaaS before anything needs a persistent process); a VPS (ops burden)                                                                                                                                                                                                                                                                                                                                                                      |
| **007** | REST + OpenAPI-generated typed client (not GraphQL/tRPC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | NestJS-native, learning-relevant, tooling-mature; contracts package closes the type gap that would otherwise argue for tRPC                                                                                                                                                                                                                                                                          | tRPC (couples FE to Nest internals, weaker fit with NestJS idioms); GraphQL (overkill for one consumer)                                                                                                                                                                                                                                                                                                                                                                   |
| **008** | Tasks widget: Postgres `tasks`, quick-add parsed client-side, undo instead of confirm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Reference CRUD widget; structured payloads only cross the wire; `task.completed` event feeds automations/streaks                                                                                                                                                                                                                                                                                     | Join-table tags (overkill for personal scale); confirmation dialogs (friction; undo with keyboard/SR path instead)                                                                                                                                                                                                                                                                                                                                                        |
| **009** | Mood widget: immutable check-in events, multiple per day; trend = per-day average                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Matches `created_at`-keyed schema; undo-not-edit keeps writes append-only; toggle buttons over radiogroup (press commits immediately)                                                                                                                                                                                                                                                                | One-per-day upsert row (loses intra-day signal); hover-only trend tooltip (inaccessible — `role="img"` + hidden table instead)                                                                                                                                                                                                                                                                                                                                            |
| **010** | Braindump widget: optimistic loss-proof capture over Mongo `braindump_notes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Zero-friction capture is the core promise; input clears immediately, inline retry on failure; promote-to-task via API composition                                                                                                                                                                                                                                                                    | Server-ack-first capture (feels laggy, risks losing text); persistent offline queue (offline-first is an ADR non-goal)                                                                                                                                                                                                                                                                                                                                                    |
| **011** | Japanese WOTD widget (accepted 2026-07-17): repo-pool word served by `LearningModule`, **UTC learning day**, eligible-set pick (pool − seen − skipped, pinned in `progress/japanese-wotd.json`) with **carry-over until resolved**; **acknowledge is the only streak source**, skip retires a known word, "Add to Anki" is a card-file save (ADR-024/026); JLPT chip optional, examples plain, romaji default-off                                                                                                                                                                  | On-read + one fixed UTC day = no missed-tick/tz-edge failures; progress file = no repeats until pool exhaustion; a save can be an already-known word, so only the explicit acknowledge is evidence of learning; the widget carries no Anki protocol at all                                                                                                                                           | Worker-precomputed daily pick (cron dependency for a read); zero-state hash selection (repeats within ~2 months, never covers the pool); streak on view/save (measures app-opening, not learning); AnkiConnect queue-and-flush (the original design — superseded by ADR-026)                                                                                                                                                                                              |
| **012** | Grammar widget (accepted 2026-07-17): authored `pool/grammar/` files in the learning repo (no open JLPT grammar dataset, ADR-032), served by `LearningModule` — `JapaneseModule` dissolves; sequenced JLPT curriculum under a client-sent `jlptCeiling`, UTC day with carry-over, review mode on exhaustion; "mark studied" is the only streak source                                                                                                                                                                                                                              | Authoring = a reviewed commit, editable on github.com, bracket furigana repo-wide; sequence beats random for prerequisite-ordered grammar; one store, one module, one event→streak path across learning kinds                                                                                                                                                                                        | Mongo `jp_content` docs (the original store — a lone DB tenant + seed pipeline for hand-authored content); random daily pick (no progression); in-widget SRS (Anki is the SRS, ADR-025 rejected); server-side read of widget settings (the ceiling now rides the request)                                                                                                                                                                                                 |
| **013** | Tech-lesson widget (accepted 2026-07-18): one definition instantiated per track; authored `pool/tech/` files in the learning repo with Shiki tokens baked by `tools/lesson-ingest`; sequential curriculum day-pinned on the UTC learning day with carry-over; `lesson.completed` is the only streak source                                                                                                                                                                                                                                                                         | Per-instance settings fit the SDK; pre-tokenized dual-theme code needs no client highlighter and no HTML injection; authoring = a reviewed commit like grammar (ADR-012), taking Mongo's learning tenancy to zero; one UTC day rule across all learning kinds                                                                                                                                        | Mongo `lesson_content` (the drafted store — a lone learning tenant after ADR-012/024); one multi-track widget (fights per-instance settings); client-side highlighting (bundle + CSP cost); date-hash shuffle (breaks prerequisite ordering)                                                                                                                                                                                                                              |
| **014** | Streaks widget (accepted 2026-07-18): event-subscribed `StreaksService`, 03:00-local grace boundary for every source (learning kinds pace on UTC but credit home-tz days), `recomputeDay` retraction for declared un-do events (`habit.unmarked`, ADR-027's owed amendment), acknowledge-only learning sources (`wotd.acknowledged`/`grammar.studied`/`lesson.completed`), read-only API                                                                                                                                                                                           | Emitters stay streak-unaware via event→streak map; `streak_days` gives idempotent day-marks; one uniform streak-day semantics across sources; retraction keeps undo honest without a general rewrite path; no "at risk" nudges (wellbeing over engagement)                                                                                                                                           | Generic `activity.recorded` event (couples emitters to streaks); strict-midnight boundary (00:30 activity unfairly breaks streaks); UTC streak days for learning sources (splits `local_date` semantics per key); accepting the unmark drift (a visibly un-earned day)                                                                                                                                                                                                    |
| **015** | Reminders widget: server-expanded today view; schedule picker compiled to cron server-side                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Same evaluator as the worker (no drift); raw cron never reaches the UI; push permission asked only from explicit in-widget action                                                                                                                                                                                                                                                                    | Client-side cron expansion (tz/DST drift); raw cron input (hostile UX); permission prompt on load (denial-by-reflex)                                                                                                                                                                                                                                                                                                                                                      |
| **016** | Journal widget: TipTap editor, dedicated route, local-first autosave, allowlisted doc schema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ProseMirror JSON model is decade-stable (format is sticky — closes Q2); IndexedDB drafts survive outages; server re-derives plaintext/search                                                                                                                                                                                                                                                         | Lexical (0.x serialization churn); Plate (Slate format churn, weak IME record); modal editor (focus-trap fragility, no deep links)                                                                                                                                                                                                                                                                                                                                        |
| **017** | Appreciation widget: standalone module + widget (Postgres), placed adjacent to Journal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nesting inside Journal's card would break §4.2 isolation (boundaries, settings); short flat rows + count queries fit Postgres/RLS                                                                                                                                                                                                                                                                    | Journal-nested section (violates widget isolation); Mongo storage (no doc shape to justify it)                                                                                                                                                                                                                                                                                                                                                                            |
| **018** | Calendar widget: own-events CRUD, server-expanded RRULE, date-typed all-day events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | External sync deferred (OAuth custody vs G2/NFR-8); ≤366-day/≤500-occurrence expansion caps; CHECK makes the all-day tz-shift bug unrepresentable                                                                                                                                                                                                                                                    | Google/CalDAV sync in v1 (ops burden); client-side RRULE expansion (drift); timestamptz all-day events (classic shifted-date bug)                                                                                                                                                                                                                                                                                                                                         |
| **019** | System-design widget (accepted 2026-07-18): own widget on LearningModule's rails; authored `pool/system-design/` files (dagre-laid flowchart IR emitted by `tools/lesson-ingest`, required `altText`), UTC learning day; Anki cards ship the diagram as media (content-hashed repo file + `sync_media`); saved cards gain optional repo-stored personal notes (all kinds, ADR-024/026 amended)                                                                                                                                                                                     | Content shape diverges (diagram + tradeoff table, no code block) so it can't be an ADR-013 track; an IR means markup never exists — injection is unrepresentable, not merely mitigated; the repo store and UTC day are inherited from ADR-013 as accepted                                                                                                                                            | Track of ADR-013 (multi-shape widget); Mongo `lesson_content` union (left with ADR-013's store); client-side mermaid (bundle + CSP + DOM injection); pre-rendered SVG injected or as `<img>` (loses the a11y tree + theming); free-text self-check field (replaced by card notes)                                                                                                                                                                                         |
| **020** | RSS feed widget (rewritten at PO review 2026-07-16): headlines + plain-text excerpts that link out to the publisher; unread/saved flags; server-side polite polling (conditional GETs, backoff, SSRF guards); Postgres only — no stored bodies, no reading route                                                                                                                                                                                                                                                                                                                   | The want is a feed to glance, not an in-app reader; plain-text-only ingest leaves no markup anywhere in the system (no sanitiser, no injection surface); an item is a flat row with two flags — §4.3's Postgres column once bodies are gone; CORS forces the server fetch anyway                                                                                                                     | The draft's full in-app reader (block-document bodies in Mongo, `/reader` route, image policy — every hard part served the unwanted half; design preserved in git history); sanitised-HTML excerpts (a sanitiser + CVE surface for two lines of preview); client-side fetching (CORS, IP exposure); hosted feed API (a third party learns everything read)                                                                                                                |
| **021** | Stocks/FX watchlist: provider port (Twelve Data free tier), worker-polled batch quotes into a shared `market_quotes` cache; watchlist rows in Postgres/RLS; `asOf` ≠ `fetchedAt`                                                                                                                                                                                                                                                                                                                                                                                                   | Keys never reach the client, and provider traffic scales with the symbol set and the clock rather than page loads — the only shape that fits NFR-8's free tier; a delayed price rendered as live is a lie                                                                                                                                                                                            | Client-direct calls (key leak, quota blown by reloads); cache-aside on read (stampede, provider latency in p95); Yahoo scraping (ToS); paid data (exceeds the whole infra budget); price alerts (anxiety)                                                                                                                                                                                                                                                                 |
| **022** | Weather: API proxies Open-Meteo into a coordinate-keyed cache; fixed home location in settings, coordinates rounded to 2 dp; geolocation only behind an explicit button; FMI open-data warnings for Finnish locations (PO addition — display only, never push)                                                                                                                                                                                                                                                                                                                     | A keyless provider still must not see the user's IP on every dashboard load (NFR-7); a shared cache serves all devices; rounding gives forecast-grade accuracy while holding no precise location; the module stores zero user data                                                                                                                                                                   | Browser geolocation as primary (prompt-on-load — ADR-015's denial-by-reflex; over-precise); direct client fetch (carves an ADR-004 exception exactly where it's easy); server-side IP geolocation (un-consented inference)                                                                                                                                                                                                                                                |
| **023** | Work tracker: Postgres `work_entries` + `review_periods` (RLS), typed impact/project/skill dimensions, plain-text body, server-rendered markdown export; PATCH allowed                                                                                                                                                                                                                                                                                                                                                                                                             | Queries are relational (period, project, impact counts) and the body is incidental — §4.3 points at Postgres, and RLS matters most on this dataset; entries are drafts you sharpen, so unlike mood they are mutable; the export format is the product                                                                                                                                                | Mongo alongside journal (hand-rolled aggregations, loses RLS); a section of Journal or a tag on Appreciation (two semantics in one table; kills the gratitude tone); TipTap (ADR-016's whole stack for bullet points); auto-deriving wins from `task.completed` (a win is a claim, not an inference)                                                                                                                                                                      |
| **024** | GitHub `learning-center` repo **is the store** (rewritten 2026-07-16 — no Mongo for learning data): JMdict-derived word pool (pinned ingest, `tools/jmdict-ingest`) + one card file per saved item, read/written by `LearningModule` via the Contents API (fine-grained PAT in env), cached in memory with serve-stale degradation                                                                                                                                                                                                                                                 | One source of truth the user owns and edits in any git client; export = `git clone`; zero database surface at single-user scale; a cache bounds GitHub-on-the-read-path (worst case: a stale word, a retryable save); §5.2 custody holds (PAT server-side, Contents-only, single repo)                                                                                                               | Mongo record + write-behind mirror + reconcile (the 07-14 draft — machinery disproportionate at this scale; kept as escape hatch); client-side writes (token in the browser); runtime dictionary API (ADR-032); SRS state in front-matter (a commit per review)                                                                                                                                                                                                           |
| **025** | **Rejected (PO, 2026-07-17).** Proposed an in-app FSRS review widget (`ReviewModule`/Postgres, `srs_owner` one-scheduler invariant); declined — Anki is the SRS for everything, and with every saved card Anki-bound (ADR-024/026) the app-owned review population would never exist. A future learning-center _view_ (a dedicated page, not a widget) may present such study tasks                                                                                                                                                                                                | The widget's premise (review must happen in-app) dissolved when ADR-026 made Anki device-independent via AnkiWeb; one-scheduler-per-item survives as the guiding rule — Anki holds every item; the FSRS/`srs_owner` design is the recorded starting point if a future view ever schedules anything                                                                                                   | (Rejected ADR — its alternatives table records the scheduler survey: SM-2, Leitner, double-scheduling; ADR-012's "Anki _is_ the SRS" stance stands un-superseded)                                                                                                                                                                                                                                                                                                         |
| **026** | Anki sync with no desktop in the loop: the learning repo's GitHub Action (thin caller → composite action in this monorepo, tag `anki-sync-v1`) runs the official `anki` library — sync down from AnkiWeb, upsert notes keyed on `CardId` (+ deterministic `guid cc:<id>`), sync up, commit `sync/state.json`; dispatch-only `mode: import` exports the existing deck into card files (never syncs up); saving a card _is_ "Add to Anki"; **accepted 2026-07-17**: recognition-only cards by default, literal `Japanese`/`Tech` deck names, real AnkiWeb account in Actions secrets | The official client library speaks the real sync protocol (sanctioned scripting, not scraping), so AnkiWeb — which already solves multi-device — is reachable from CI with credentials in the user's own Actions secrets; the repo is the queue and `state.json` is the report (no endpoint, no machine token, no Mongo); sync-down → upsert → sync-up (never full-upload) keeps mobile reviews safe | AnkiConnect queue-and-flush (the 07-14 draft — desktop-gated, pending-for-days on mobile); AnkiWeb HTML scraping (ToS, R2); self-hosted sync server (collection custody + device re-pointing); `.apkg` via genanki (still needs a manual desktop import); sync from our worker (AnkiWeb credentials on our backend); a report endpoint + machine token (existed to fill Mongo the store no longer has); subdecks; `Basic` note type; schedule import back (corrupts FSRS) |
| **027** | Habit widget: Postgres `habits` + idempotent `habit_marks` day-marks; emits `habit.marked` and owns no streak logic; reminders are Automations                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reuses ADR-014's day/grace semantics and ADR-015's scheduler instead of copying either; PK-based marks make double-marking unrepresentable; the no-guilt posture is inherited                                                                                                                                                                                                                        | Own streak counters (drift on day boundaries); a habit-owned cron (a worse copy of AutomationModule); habits-as-recurring-tasks (drowns the to-do list); "at risk" nudges (dark pattern)                                                                                                                                                                                                                                                                                  |
| **028** | Pomodoro widget: deadline-based client timer (`endsAt`, not tick counting), local `Notification`, only completed focus sessions persisted                                                                                                                                                                                                                                                                                                                                                                                                                                          | Timestamps make setInterval drift and tab-throttling bugs unrepresentable; a 60 s push SLO is useless for a 25-minute timer, so no server round trip; a `client_key` UNIQUE keeps completion idempotent                                                                                                                                                                                              | Tick-counting interval (wrong under throttling); server-scheduled push (invents distributed state, too slow); service-worker countdown (also throttled); an `aria-live` countdown (announces every second)                                                                                                                                                                                                                                                                |
| **029** | Fitness widget: manual workouts with a relational `workout_sets` table (per-set strength detail, PO decision) + a narrow `health_metrics` series in Postgres (seeded: weight, sleep, steps, activity); integrations deferred behind a `source`/`external_id` seam with **Withings committed as the named next ADR** (PO owns the devices)                                                                                                                                                                                                                                          | OAuth/webhook custody dwarfs the widget (G2/NFR-8) — the ADR-018 deferral pattern; Apple Health is impossible without a native app (a §1.3 non-goal); health data joins the §5.3 highest-value tier; per-exercise progression is a SQL query only against set rows, not a jsonb blob                                                                                                                 | Garmin/Strava/Fitbit OAuth in v1; Apple Health (no server API); `sets jsonb` (progression queries become blob archaeology); CSV/GPX import (superseded by the Withings commitment); a wide metrics table (a migration per metric); user-unit storage (mixed-unit charts); goal/deficit UI                                                                                                                                                                                 |
| **030** | Finance widget: manual balances + server-side CSV import (preview→commit, hash dedupe), integer cents, `date` booking days; bank aggregators deferred                                                                                                                                                                                                                                                                                                                                                                                                                              | Open banking costs money, expires every 90 days (SCA), and upgrades the worst case to full transaction-history exfiltration (§5.3); stocks (ADR-021) is market data, finance is the user's own money                                                                                                                                                                                                 | PSD2 aggregator/Plaid in v1; credential storage or scraping; client-side CSV parsing; float amounts; `timestamptz` booking dates; third-party merchant enrichment                                                                                                                                                                                                                                                                                                         |
| **031** | Home Assistant: browser-direct-to-LAN (formerly the AnkiConnect precedent — retired by ADR-026, this ADR now carries the pattern alone), token in `localStorage` only, read-only v1, HA never an automation action                                                                                                                                                                                                                                                                                                                                                                 | Keeps §5.3 architecturally — our servers hold no HA token and have no LAN route, so a backend compromise still cannot actuate the house; HA's own engine stays authoritative                                                                                                                                                                                                                         | Nabu Casa/tunnel integration server-side (a full-control token in our backend); control in v1 (physical actuation without a threat-model revision); rebuilding HA's trigger engine; the token in `settingsSchema`                                                                                                                                                                                                                                                         |

| **032** | Learning content (accepted 2026-07-18): ingest pinned JMdict / JmdictFurigana / Tatoeba release artefacts into the learning repo's pool (no runtime API); typed `license` block required per item, source × release attribution rows in the pool manifest; JLPT levels are curated annotations ("≈ N4", tanos.co.uk-seeded, chip only when present); grammar/tech/system-design content authored (`proprietary-own`); attribution in the about panel — the deployment and repo are private, so no distribution occurs | Closes R5 — a pinned ingest has no upstream to be unavailable; no official JLPT lists and no open-licensed grammar dataset exist; EDRDG's "each screen display" clause binds public dictionary displays, recorded as a tripwire: a public deployment owes the WOTD card a persistent footer line on day one, and a public repo carries CC BY-SA | Jisho's unofficial API (no terms, and its data _is_ JMdict); WaniKani (Tofugu copyright, no redistribution licence); a live dictionary API on the read path; a worker cron over GitHub releases (unattended writes to the app's most important data); LLM-generated grammar (no provenance; quality _is_ the product); always-visible card footer (withdrawn at acceptance — private deployment) |
| **033** | Calendar gains a shared, read-only `public_holidays` reference table (Nager.Date, keyless), worker-prefetched per country-year and served on its own endpoint | ADR-018's deferred calendar sync gets most of its felt value with no OAuth custody, for data with no privacy dimension; holidays stored as `calendar_events` rows would be editable, duplicable, and would pollute the export | Google holiday calendars via OAuth (a full calendar grant to buy a public-domain fact); ICS feeds (unversioned; inherits ADR-020's SSRF apparatus); Calendarific/HolidayAPI (a key + quota for public-domain facts); hardcoding Finnish holidays (Easter is computed) |
| **034** | **Rejected (PO, 2026-07-16).** Proposed moving FX from Twelve Data to keyless daily ECB reference rates via Frankfurter; declined — the watchlist's purpose is _current_ market data, and the finance half went moot when ADR-030 was parked. FX stays on Twelve Data inside ADR-021's budget | The daily-granularity trade was the ADR's own headline condition, and the PO declined it; the Frankfurter/ECB research (keyless, quota-free, self-hostable, verified 2026-07-14) stands as the reference if finance revives | (Rejected ADR — its own alternatives table records the provider survey; ADR-021 records the standing decision: Twelve Data for both FX and equities) |
| **035** | New transit-departures widget (HSL/Digitransit, free server-side key); 30 s shared cache-aside + visibility-gated polling — the documented exception to ADR-021's no-poll-on-read rule | A 5-minute-old departure is wrong, not stale, so worker-polling would be confidently wrong; the exception is safe only because the provider isn't credit-metered and traffic is bounded by the user actually looking; the licence's required retrieval timestamp _is_ the honest UI | Worker-polled cache (too slow to be correct); client-direct calls (key leak; defeats the shared cache); "leave now" push (NFR-3's 60 s SLO can't be trusted with a bus); Google Transit (billing account, ad company); geolocation on load (ADR-015's denial-by-reflex) |
| **036** | Recurring tasks: one open occurrence per series, respawn-on-completion (transactional, no worker), RRULE compiled from a structured `repeat` descriptor via a shared `packages/` recurrence utility; the calendar overlay gains server-projected `projected: true` occurrences | No cron dependency → no missed-tick failure class; a partial unique index makes double-spawn unrepresentable; missed occurrences don't pile up (ADR-027's no-guilt posture applied to obligations); one expander serves tasks and calendar without a module import | Worker-materialized instances (missed-tick bugs, future-row litter); separate `task_series` table (join + forked flows for overrides todos don't need); respawn-by-update (loses done history); cron grammar (can't say "every 2 weeks"); habits-as-the-model (no deadline/overdue) |
| **037** | Google Calendar sync: OAuth code flow with encrypted server-held refresh token, incremental scopes (read-only until a calendar is marked read-write), per-calendar `mode`, worker-polled `syncToken` sync every 10 min, `singleEvents=true` instance mirror over a rolling horizon, write-through with etag conflict 409s | Lifts ADR-018's deferral through its `source`/`external_id` seam with zero read-contract change; background sync forces server custody (opposite of ADR-031, argued in place); Google is the source of truth so the mirror can be purged/rebuilt; least-privilege scopes mean a read-only setup never holds a write-capable token | CalDAV/ICS layer (read-only, unversioned; wrong ask); watch channels in v1 (webhook + renewal machinery for freshness a 10-min poll delivers); importing master+override series (forces ADR-018's deferred model); full two-way mirror of own events (echo loops); browser-held token (can't feed the worker); last-writer-wins (silent data loss on a real calendar) |

| **038** | Nutrition widget: personal food library + food-entry log in Postgres (`foods`, `food_entries`); entries snapshot name/kcal at log time; `kcal` is nullable — unknown is a first-class state and daily totals report "N kcal · M uncounted"; kcal-only v1, no external food DB | Capture speed is the product (one tap for the foods the user always eats); requiring kcal blocks the habit and teaches number-inventing — "tracking is the first step" (PO brief); snapshots keep past totals honest when the library changes; eating data is §5.3 highest-value with the no-shaming posture at extra force | Folding into FitnessModule (different shapes/UX/failure domains); public food DB or barcodes in v1 (licensing + lookup UX dwarf a personal vocabulary); required kcal (blocks the habit); join-not-snapshot (library edits silently rewrite history); macros in v1 (kcal answers the current question) |
| **039** | Automation delivery (Phase 2 MVP): NFR-3 relaxed to best-effort by PO decision (2026-07-18); a free external pinger (cron-job.org, 1-min) POSTs a secret-guarded `/internal/tick`; the API runs the §4.5 pipeline inline — cursor window, claim via `UNIQUE(automation_id, slot)`, bell row as delivery of record, Web Push fan-out; event automations dispatch inline on `task.completed`; ADR-005 deferred, ADR-006 revisit resolved (nothing leaves Vercel) | The 60 s SLO was the only force demanding an always-on process; with it relaxed, the simplest never-lose/never-double design is a claim-row scheduler on the platform already running — $0/mo, one deploy pipeline, and the riskiest planned integration (pg-boss ↔ pooler in a persistent worker) leaves the phase; a leaked tick secret can only run the idempotent scheduler early | Railway worker + pg-boss now (~$5/mo — kept as the recorded upgrade path); Vercel Hobby cron (daily-only, hour-loose); Vercel Pro ($20 = the whole NFR-8 budget); GitHub Actions cron (5-min nominal, loose/dropped); pg_cron + edge functions (ADR-005 objection stands); unauthenticated tick (cheap defense in depth refused); raw `DATABASE_URL` in serverless (connection trap; service-role HTTP client instead) |

ADRs 019–039 are tracked in `docs/adr/REVIEW-QUEUE.md`; 019, 020, 021, 022, 023, 024, 026, 027, 028, 029, 032, 033, 036, 037, and 038 are **accepted** (011, 012, 013, and 014 too, tracked in the index), 025 and 034 are **rejected**, and 030, 031, and 035 are **parked** (product-owner walkthroughs, 2026-07-16 to -18). **039 is proposed** (drafted 2026-07-18, pending walkthrough) — everything earlier is decided; see the queue for the review
state of each. ADR-032's acceptance (2026-07-18) **closed R5** — licensed bulk datasets for
Japanese vocabulary, authored content for everything else; the R5 row in §8 records the decision. The 2026-07-16 rewrites of ADR-024/026
(GitHub `learning-center` repo is the store — no Mongo for learning data; sync via the learning
repo's GitHub Action → AnkiWeb with results in `sync/state.json`) retired AnkiConnect and the
planned `vault_items`/`anki_snapshots` Mongo collections from the architecture; their owed edits
were **applied on ADR-026's acceptance (2026-07-17)**, which rewrote
§4.3's Mongo ownership list, §4.5's Anki paragraph, the §2 container diagram and failure-mode row,
§5.2's AnkiConnect CORS scope, R2, and Phase 3's "Anki queue-and-flush". ADR-036's and ADR-037's
owed edits were applied on their acceptance (2026-07-16): §4.4 gained the new `tasks` columns
(`rrule`, `repeat`, `series_id`, `spawned_from`), §2 the Google Calendar API system and failure
row, §4.4 the `calendar_accounts`/`calendar_sources` tables and `calendar_events` source columns,
§5.3 the refresh-token asset entry, and Phase 4 the sync scope line.

---

## 8. Risks & Open Questions

| #   | Risk / question                                                                    | Impact                                        | Mitigation / decision needed                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Dual-DB is 2× the migrations, backups, client libs                                 | Slower iteration                              | Fallback documented in ADR-003; re-evaluate after first 3 widgets ship                                                                                                                                                                                                                                                                                                                     |
| R2  | Anki sync-protocol drift (the pinned `anki` library ages until AnkiWeb rejects it) | Sync fails red until the pin is bumped        | ADR-026's daily scheduled run turns drift into a red run within a day; a bump ships by moving the `anki-sync-v1` tag. (The original risk — desktop-only reachability — was retired by ADR-026; AnkiWeb scraping stays banned, ToS)                                                                                                                                                         |
| R3  | Free-tier limits (Supabase pauses inactive projects; Atlas M0 caps)                | Surprise downtime                             | Uptime ping doubles as keep-alive; document tier limits in runbook                                                                                                                                                                                                                                                                                                                         |
| R4  | Web Push on iOS requires installed PWA                                             | Missed reminders on iPhone                    | Document install step; in-app notification center as fallback                                                                                                                                                                                                                                                                                                                              |
| R5  | Content sourcing for WOTD/lessons (licensing, quality)                             | Learning widgets are the heart of the product | Decided (ADR-032, accepted 2026-07-18): pinned JMdict/JmdictFurigana/Tatoeba release artefacts ingested to the learning repo's pool — no runtime provider, nothing to be unavailable; grammar/tech/system-design content authored; typed `license` block required per item; private deployment → attribution in the about panel, EDRDG footer line is the tripwire for any public exposure |
| Q1  | Timezone handling for automations (travel, DST)                                    | Wrong-time reminders                          | Decided (ADR-014/015): single home IANA tz on profile; worker evaluates tz-aware; streak days use a 03:00-local grace boundary for every source — learning content paces on the UTC day (ADR-011/012/013) but streaks credit home-tz days uniformly (ADR-014 as accepted)                                                                                                                  |
| Q2  | Journal editor choice (TipTap vs Plate vs Lexical)                                 | Rich-text data format is sticky               | Decided (ADR-016): TipTap; format = ProseMirror JSON doc model, `schemaVersion` stamped per entry                                                                                                                                                                                                                                                                                          |

---

## 9. Delivery Phasing

1. **Phase 0 — Skeleton:** monorepo scaffold, CI, auth end-to-end, empty dashboard shell with widget registry, one trivial widget (clock). _Proves the whole pipe._
2. **Phase 1 — Daily core:** Tasks, Braindump, Mood check-in + trends. First Postgres + first Mongo widget → validates ADR-003 early.
3. **Phase 2 — Automations:** trigger engine, worker, web push, notification center. _Highest architectural risk — do before more widgets._
4. **Phase 3 — Learning:** Japanese WOTD/grammar, tech "X of the day", streaks, Anki sync via the learning repo's GitHub Action (ADR-024/026).
5. **Phase 4 — Reflection & polish:** Journal, Appreciation, Calendar views, Google Calendar sync (per-calendar read-only/read-write, ADR-037), layout customization UI, data export.

Each phase ends deployed and used daily — the product owner is also user #1, so dogfooding is the QA strategy.
