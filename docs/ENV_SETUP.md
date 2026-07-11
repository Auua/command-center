# Environment setup

Secrets never live in the repo (ARD §5.2). Local dev needs two gitignored files;
`bash scripts/setup-env.sh` creates both with placeholders.

## 1. Create a Supabase project

1. <https://supabase.com/dashboard> → New project (free tier is fine, NFR-8).
2. Enable 2FA on your Supabase account (NFR-6).
3. Project Settings → API: copy the **Project URL** and the **anon / public** key.
   The anon key is safe in the browser — Row Level Security does the real gating.
4. SQL Editor → run `supabase/migrations/0001_widget_layouts.sql`.
5. Authentication → Providers → Email: enabled by default. For fastest first
   sign-in you can disable "Confirm email" (single-user app), or keep it on and
   use the `/auth/callback` confirmation flow.

## 2. Fill in the env files

### `apps/web/.env.local` (Next.js)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, e.g. `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon / public key |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

### `apps/api/.env` (NestJS API + worker)

| Variable | Value |
|---|---|
| `PORT` | `3001` |
| `CORS_ORIGIN` | `http://localhost:3000` (comma-separate extra origins) |
| `SUPABASE_URL` | same Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | same anon key (API queries run under the user's JWT + RLS) |
| `SUPABASE_JWT_SECRET` | **only** legacy HS256 projects; leave unset on new projects (JWKS is used) |

No `service_role` key anywhere — the API deliberately runs RLS-scoped (ARD §5.1).

## 3. Later phases (not needed yet)

- `MONGODB_URI` — Atlas cluster, Phase 1 (journal/braindump).
- `DATABASE_URL` — direct Postgres connection for pg-boss, Phase 2.
- VAPID keypair for Web Push, Phase 2.

## 4. Deploy targets

Set the same variables in the platform dashboards: Vercel (web) and
Railway/Fly (api + worker). `CORS_ORIGIN` must list the deployed web origin.
