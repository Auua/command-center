# Environment setup

Secrets never live in the repo (ARD §5.2). Local dev needs two gitignored files;
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

| Variable                               | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Project URL, e.g. `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon / public key                                |
| `NEXT_PUBLIC_API_URL`                  | `http://localhost:3001`                          |

### `apps/api/.env` (NestJS API + worker)

| Variable                   | Value                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `PORT`                     | `3001`                                                                      |
| `CORS_ORIGIN`              | `http://localhost:3000` (comma-separate extra origins)                      |
| `SUPABASE_URL`             | same Project URL                                                            |
| `SUPABASE_PUBLISHABLE_KEY` | same anon key (API queries run under the user's JWT + RLS)                  |
| `MONGODB_CONNECT`          | MongoDB Atlas connection string (Phase 1: braindump; later journal/content) |

No `service_role` key anywhere — the API deliberately runs RLS-scoped (ARD §5.1).

### MongoDB Atlas (Phase 1)

1. <https://cloud.mongodb.com> → create a free **M0** cluster (NFR-8). Enable 2FA (NFR-6).
2. Database Access → create a dedicated user for this app, **read/write scoped to
   one database only** (ARD §5.1) — not `atlasAdmin`.
3. Network Access → allow your dev IP (and later the backend host's egress IPs).
4. Copy the connection string into `MONGODB_CONNECT`. If the URI path names a
   database (`…mongodb.net/command_center`), that database is used; without a
   path the API defaults to `command_center`.

Collections (`braindump_notes`, …) and indexes are created on first use — no
migration step.

## 3. Later phases (not needed yet)

- `DATABASE_URL` — direct Postgres connection for pg-boss, Phase 2.
- VAPID keypair for Web Push, Phase 2.

## 4. Deploy targets

Set the same variables in the platform dashboards: Vercel (web) and
Railway/Fly (api + worker). `CORS_ORIGIN` must list the deployed web origin.
