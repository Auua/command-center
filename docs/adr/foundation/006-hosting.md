# ADR-006: Hosting — everything on Vercel + managed data tiers

- **Status:** Accepted
- **Date:** 2026-07-11 (hosting record corrected 2026-07-18)
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

The system has three deployables (Next.js web, NestJS API, NestJS worker — ADR-002) and two
managed data stores (ADR-003). G2 says the whole thing must survive weeks of neglect; NFR-8
caps infrastructure at ≤ €20/mo; NFR-13 forbids hard platform lock-in. The fewer platforms,
dashboards, and deploy pipelines there are, the better the neglect-survival odds — every
additional PaaS is another billing relationship, another credential set, another thing that
breaks silently.

Record note: on 2026-07-17 the architecture docs were briefly "corrected" to say the backend
ran on Render — describing a deployment that never happened. Corrected again on 2026-07-18:
web and API are in fact both hosted on **Vercel**, and this ADR records that reality.

## Decision

We will host **everything on Vercel** — the Next.js app and the NestJS API (and the worker
entrypoint, within the constraint below) — with data on managed free tiers: **Supabase Free**
(Postgres + Auth) and **MongoDB Atlas M0**.

- **One platform, one deploy pipeline**: a push deploys web and API together, which fits the
  monorepo's one-PR-spans-both model (ADR-001).
- **Standing constraint, decided later by design**: a long-running pg-boss queue consumer
  (ADR-005) does not fit Vercel's function model — nothing in Phase 0–1 needs a persistent
  process, so the worker's home is deliberately _not_ chosen yet. The candidates when Phase 2
  lands: Vercel cron driving the tick, or a small separate host for the worker alone. Choosing
  a second platform today would be paying for the answer before the question is due.
  _ADR-039 (proposed, 2026-07-18) resolves this clause for the Phase-2 MVP: Vercel Hobby cron
  turned out daily-only, NFR-3 was relaxed to best-effort, and the tick arrives over HTTP from
  a free external pinger — nothing leaves Vercel, and no worker process exists._
- **NFR-13 portability holds by construction**: the web app builds standalone
  (`output: "standalone"`) and the API carries a Dockerfile — both runnable on any host, so
  leaving Vercel is a redeploy, not a rewrite.
- Secrets live in the platform dashboards (Vercel / Supabase / Atlas env vars), never in the
  repo (§5.2); all three dashboards sit behind 2FA (NFR-6).

## Consequences

- One deploy pipeline and one hosting bill (currently €0 — hobby/free tiers throughout);
  NFR-8 is met with the full margin available for future paid needs.
- Free-tier behaviors are inherited risks: Supabase pauses inactive projects and Atlas M0 has
  hard caps (R3) — the NFR-10 uptime ping doubles as keep-alive, and tier limits are runbook
  material.
- The worker-hosting question is consciously open. This is the one place the "one platform"
  claim is provisional; Phase 2 cannot ship without closing it, which is exactly when the
  real requirements (tick cadence, job volume) will be known.
- Vercel's serverless model shapes the API's runtime assumptions (no in-process state between
  invocations that matters, no background work after response) — consistent with where
  durable work already lives: the queue (ADR-005).

## Alternatives considered

- **Render / Railway / Fly.io for the backend** — natural homes for a persistent NestJS
  process, and the likely shortlist when the worker needs one. Rejected _for now_: a second
  PaaS before anything needs a persistent process is premature cost and surface. (The 07-17
  record error made this rejection look like the decision; it never was.)
- **A VPS** — full control, one flat fee, would host all three processes trivially. Rejected
  on G2: patching, monitoring, and securing a box is exactly the operational burden this
  project must not carry.
- **Supabase Edge Functions as the API host** — keeps compute next to the data, but forces
  the ADR-004-rejected architecture (logic scattered into edge functions) through a hosting
  decision. Rejected.
- **Splitting web (Vercel) and API (elsewhere) from day one** — the conventional pairing, but
  two pipelines and two platforms to keep alive for zero current benefit; becomes the fallback
  posture only if the worker constraint resolves toward "separate host" _and_ co-locating the
  API there turns out cheaper. Deferred with the worker decision.
