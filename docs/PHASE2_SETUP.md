# Phase 2 setup runbook — external dependencies (one-time)

Everything the automations MVP (ADR-039) needs outside this repo: database
migrations, three secrets in Vercel, a free cron pinger, and a monitor. Done
once by the product owner, top to bottom; each step is copy-pasteable.
Estimated time: ~20 minutes.

Prerequisites: the `phase2-backend` (API) and Phase-2 frontend branches are
merged and deployed on Vercel. `<api-host>` below means the deployed API
origin, e.g. `command-center-api.vercel.app`.

## 1. Apply migrations in the Supabase SQL editor

> **Check first:** migrations `0002_tasks.sql` and `0003_mood_checkins.sql`
> may not be applied to the live project yet (they were pending as of Phase 1).
> In the SQL editor run:
>
> ```sql
> select table_name from information_schema.tables
> where table_schema = 'public' order by table_name;
> ```
>
> If `tasks` / `mood_checkins` are missing, run `0002` and `0003` first.

Then run, in order, each file from `supabase/migrations/` (Dashboard → SQL
Editor → paste → Run):

1. `0004_user_profiles.sql`
2. `0005_automations.sql`
3. `0006_notifications.sql`
4. `0007_scheduler_state.sql`

All four are idempotent (`if not exists` / drop-then-create policies) — safe
to re-run. Verify with the query above: `user_profiles`, `automations`,
`automation_runs`, `push_subscriptions`, `notifications`, `scheduler_state`
should all exist.

## 2. Service-role key → Vercel (API project only)

1. Supabase Dashboard → Project Settings → API keys → copy the **secret**
   key (called service_role on older projects). This key bypasses RLS —
   treat it like a database password.
2. Vercel → the **API** project → Settings → Environment Variables → add

   | Name                  | Value          | Environments |
   | --------------------- | -------------- | ------------ |
   | `SUPABASE_SECRET_KEY` | the secret key | Production   |

   Server-only: never add it to the web project and never with a
   `NEXT_PUBLIC_` prefix. It is consumed by exactly one repository (the
   scheduler) — see ADR-039's containment rules.

## 3. Generate TICK_SECRET + VAPID keys → Vercel

On your own machine:

```bash
# the pinger's shared secret (256-bit hex)
openssl rand -hex 32

# the Web Push VAPID keypair
npx web-push generate-vapid-keys
```

Vercel → **API** project → Environment Variables (Production):

| Name                | Value                       |
| ------------------- | --------------------------- |
| `TICK_SECRET`       | the `openssl` output        |
| `VAPID_PUBLIC_KEY`  | "Public Key" from web-push  |
| `VAPID_PRIVATE_KEY` | "Private Key" from web-push |
| `VAPID_SUBJECT`     | `mailto:` + your email      |

Vercel → **web** project → Environment Variables (Production):

| Name                           | Value                          |
| ------------------------------ | ------------------------------ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the same "Public Key" (public) |

Redeploy both projects so the env changes take effect (the API fails fast at
boot if any of these is missing). Keep the production VAPID pair out of local
`.env` files — a local tick must never point at the production database or
send with production VAPID keys (dev rule, `docs/ENV_SETUP.md`).

## 4. Create the pinger job on cron-job.org

1. <https://console.cron-job.org> → sign up (free) → enable 2FA (NFR-6) →
   **Create cronjob**.
2. Settings:
   - **URL:** `https://<api-host>/api/v1/internal/tick`
   - **Schedule:** every 1 minute
   - **Request method:** POST (under Advanced)
   - **Headers** (Advanced): add `x-tick-secret` = the `TICK_SECRET` value
     from step 3 (exactly, no quotes)
   - Leave the request body empty — the tick ignores all input.
3. **Notifications:** enable failure notifications (email on failed
   execution, and "when the job is re-enabled/successful again" if offered).
   The pinger's own alerting is the dead-man's switch for the tick endpoint
   (NFR-10).
4. Save, then use "Test run" / wait a minute and check the execution history:
   the response must be **204**. A 401 means the header name or secret value
   doesn't match Vercel's `TICK_SECRET`.

Sanity check from a terminal (expect `204` with the secret, bodyless `401`
without):

```bash
curl -i -X POST https://<api-host>/api/v1/internal/tick -H "x-tick-secret: <TICK_SECRET>"
curl -i -X POST https://<api-host>/api/v1/internal/tick
```

## 5. UptimeRobot keyword monitor on /health

`GET https://<api-host>/health` now includes tick staleness, e.g.
`"tick":"ok","lastTickAt":"2026-07-19T12:00:30.000Z"` (`stale` = no tick for
over 5 minutes; `never` = no tick yet; `unknown` = state unreadable).

1. <https://uptimerobot.com> → the existing API monitor (or a new one) →
   type **Keyword**.
2. URL: `https://<api-host>/health`
   Keyword: `"tick":"ok"`
   Alert **when keyword not found**.
3. Keep the check interval at 5 minutes (free tier). This catches the case
   the pinger's own alerts cannot: cron-job.org happily getting 204s while
   the scheduler state stops advancing — and it doubles as the Supabase
   keep-alive ping (R3).

## 6. Acceptance test — the relaxed-NFR-3 contract (plan item 14)

This is the test that proves catch-up + skip behavior end to end:

1. Create a reminder with a near-future time (widget or
   `POST /api/v1/automations`), e.g. an interval automation every 5 minutes,
   and confirm a normal delivery: push arrives (or the bell row appears) and
   the run shows `sent`.
2. cron-job.org → **disable** the job. Wait ~10 minutes (≥ 2 missed slots).
   `/health` should flip to `"tick":"stale"` and UptimeRobot should alert —
   that's the monitoring path verified for free.
3. **Re-enable** the job. Within a minute the next tick catches up:
   - slots missed within the last 60 minutes fire now (late, at-least-once —
     bell rows + push for each; runs `sent`);
   - had the outage exceeded 60 minutes, older slots would be recorded
     `skipped` — visible in the widget's slot statuses and
     `GET /api/v1/automations/:id/runs`, never fired stale.
4. `/health` returns to `"tick":"ok"`; delete the test automation.

Done. Total added cost: $0/mo (Vercel Hobby + Supabase free + cron-job.org
free + UptimeRobot free — NFR-8).
