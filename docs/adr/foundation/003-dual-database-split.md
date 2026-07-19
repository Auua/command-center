# ADR-003: Dual database with strict ownership split (Supabase Postgres + MongoDB Atlas)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Review:** accepted as an ADR §7 summary row (2026-07-11); expanded to a full ADR 2026-07-19

## Context

The stack is deliberately a learning vehicle (G3): Postgres and MongoDB are both skills worth
building, and this project is the sanctioned place to build them. At the same time the data
genuinely has two shapes — relational rows queried with filters and aggregations (tasks, mood
trends, streak counters, layouts) and schema-flexible documents (journal rich text, braindump
notes) — and Supabase brings auth, RLS, and realtime that only apply to its own Postgres.
Running two databases is unambiguously more operational surface (2× migrations, backups,
client libraries — recorded as risk R1), so the redundancy must be _contained by design_
rather than allowed to leak everywhere.

## Decision

We will run **both** Supabase Postgres and MongoDB Atlas, split **by data shape**, with
containment rules that keep the second database a bounded choice:

| Store             | Data                                                                                                                                                                | Why here                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Supabase Postgres | users/profiles, tasks, calendar events, mood check-ins, streaks & progress counters, automations/triggers, push subscriptions, widget layouts, appreciation entries | Relational, queried with filters/aggregations (trends, streaks), benefits from RLS, realtime |
| MongoDB Atlas     | journal entries (rich text as structured JSON), braindump notes                                                                                                     | Document-shaped, schema-flexible content, full-text search (Atlas Search) for journal        |

Rules:

- **Exactly one owner module per table/collection** (ADR-002's ownership rule applied to
  storage). The owner is the only code that touches it.
- **No cross-database joins.** If a widget needs both (e.g., a journal entry linked to a mood
  check-in), the API composes; references are stored as opaque IDs.
- **Mongo is never exposed to the client** — access only via the API, with a dedicated DB user
  scoped to this app's database and a `userId` filter enforced in the repository base class
  (§5.1).
- **The fallback is documented up front:** if dual-DB operational cost ever outweighs the
  learning value, Mongo collections fold into Postgres JSONB columns. The one-owner rule is
  what keeps that migration scoped to the owning modules instead of a system-wide hunt.

## Consequences

- Two migration mechanisms, two backup/restore drills (NFR-5's quarterly restore test covers
  both), two client libraries — R1 is real and accepted, re-evaluated after the first three
  widgets ship. (Phase 1's outcome: braindump on Mongo, tasks/mood on Postgres — the split
  validated early, as §9 intended.)
- Shape-based placement gives every new dataset a default answer instead of a debate; ADRs
  since (017, 023, 038) resolve "which store?" by pointing at this table.
- RLS and realtime remain available exactly where the relational data lives; document data
  accepts application-enforced tenancy as its second-best.
- The split has since drifted _toward_ less Mongo, not more: learning content moved to the
  GitHub learning-center repo (ADR-024), taking Mongo's learning tenancy to zero — the
  containment rules made that retirement cheap, which is the design working.

## Alternatives considered

- **Postgres-only with JSONB for documents** — operationally simpler and fully sufficient;
  loses the MongoDB learning goal and Atlas Search. Rejected for v1 but **kept as the
  documented fallback** — the one alternative in this ADR that stays alive by design.
- **Mongo-only** — one database, but forfeits Supabase's integrated auth, RLS as a second
  authorization net, and realtime; relational queries (trends, streak aggregation) become
  application-side work. Rejected.
- **Postgres + a dedicated search service** (e.g., Meilisearch) instead of Atlas Search — a
  third moving part to host and sync, purely additive ops cost against G2/NFR-8. Rejected.
