# Environment setup

Secrets never live in the repo (ADR §5.2). Local dev needs two gitignored files;
`bash scripts/setup-env.sh` creates both with placeholders.

## 1. Create a Supabase project

1. <https://supabase.com/dashboard> → New project (free tier is fine, NFR-8).
2. Enable 2FA on your Supabase account (NFR-6).
3. Project Settings → API: copy the **Project URL** and the **anon / public** key.
   The anon key is safe in the browser — Row Level Security does the real gating.
4. SQL Editor → run every file in `supabase/migrations/` in order
   (`0001_widget_layouts.sql`, `0002_tasks.sql`, …).
5. Authentication → Providers → Email: enabled by default. For fastest first
   sign-in you can disable "Confirm email" (single-user app), or keep it on and
   use the `/auth/callback` confirmation flow.

## 2. Fill in the env files

### `apps/web/.env.local` (Next.js)

| Variable                               | Value                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Project URL, e.g. `https://abcd1234.supabase.co`         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon / public key                                        |
| `NEXT_PUBLIC_API_URL`                  | `http://localhost:3001`                                  |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Web Push VAPID **public** key (same pair as the API, §3) |

### `apps/api/.env` (NestJS API + worker)

| Variable                   | Value                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `PORT`                     | `3001`                                                                      |
| `CORS_ORIGIN`              | `http://localhost:3000` (comma-separate extra origins)                      |
| `SUPABASE_URL`             | same Project URL                                                            |
| `SUPABASE_PUBLISHABLE_KEY` | same anon key (API queries run under the user's JWT + RLS)                  |
| `MONGODB_CONNECT`          | MongoDB Atlas connection string (Phase 1: braindump; later journal/content) |
| `SUPABASE_SECRET_KEY`      | Supabase **secret / service-role** key (Phase 2 scheduler only, see below)  |
| `TICK_SECRET`              | shared secret for `POST /api/v1/internal/tick` — `openssl rand -hex 32`     |
| `VAPID_PUBLIC_KEY`         | Web Push VAPID public key — `npx web-push generate-vapid-keys`              |
| `VAPID_PRIVATE_KEY`        | Web Push VAPID private key (same command, same pair)                        |
| `VAPID_SUBJECT`            | `mailto:` your email (or an `https:` contact URL)                           |

Every user-facing endpoint runs RLS-scoped under the caller's JWT (ADR §5.1).
The one exception is the ADR-039 carve-out: `SUPABASE_SECRET_KEY` is the
service-role key, consumed **only** by the scheduler repository (tick + event
dispatch — those paths have no user JWT). It comes from Supabase Dashboard →
Project Settings → API keys → "secret" key. Server-only: never `NEXT_PUBLIC_*`,
never in the web app, rotatable from the dashboard.

**Local dev rule (ADR-039):** a locally triggered tick must never point at the
production database or send with production VAPID keys. If your local
`SUPABASE_URL`/`SUPABASE_SECRET_KEY` are the production project's, leave
`SUPABASE_SECRET_KEY` as a placeholder (the API boots fine; only the scheduler
paths fail) or use a separate dev Supabase project. Always generate a **local**
VAPID pair — the production pair exists only in the Vercel env.

### MongoDB Atlas (Phase 1)

1. <https://cloud.mongodb.com> → create a free **M0** cluster (NFR-8). Enable 2FA (NFR-6).
2. Database Access → create a dedicated user for this app, **read/write scoped to
   one database only** (ADR §5.1) — not `atlasAdmin`.
3. Network Access → allow your dev IP (and later the backend host's egress IPs).
4. Copy the connection string into `MONGODB_CONNECT`. If the URI path names a
   database (`…mongodb.net/command_center`), that database is used; without a
   path the API defaults to `command_center`.

Collections (`braindump_notes`, …) and indexes are created on first use — no
migration step.

## 3. Phase 2 secrets — how to generate

- `TICK_SECRET`: `openssl rand -hex 32` (256-bit hex). The same value goes in
  the cron-job.org job's `x-tick-secret` header (see `docs/PHASE2_SETUP.md`).
- VAPID keypair: `npx web-push generate-vapid-keys` — copy `Public Key` →
  `VAPID_PUBLIC_KEY`, `Private Key` → `VAPID_PRIVATE_KEY`. The web app needs
  the public half as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- `SUPABASE_SECRET_KEY`: Supabase Dashboard → Project Settings → API keys —
  the **secret** (service-role) key. Not needed for unit/e2e tests or ordinary
  local dev; required for the scheduler paths to work.
- No `DATABASE_URL` — ADR-039 deferred pg-boss; the scheduler uses the
  HTTPS-based service-role client instead of a raw Postgres connection.

## 4. Deploy targets

Set the same variables in the platform dashboards: Vercel hosts both web and
api (+ worker entrypoint). `CORS_ORIGIN` must list the deployed web origin.
Phase 2's one-time external setup (migrations 0004–0007, Vercel env,
cron-job.org pinger, UptimeRobot) is a step-by-step runbook in
`docs/PHASE2_SETUP.md`.
