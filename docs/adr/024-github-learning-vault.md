# ADR-024: GitHub learning vault — durable store for saved learning items

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

The learning widgets (Japanese WOTD ADR-011, grammar ADR-012, tech lessons ADR-013, quick
notes) show ephemeral daily content. What's missing is a "save what I learned" action that
persists an item durably, in a format Anna owns and can take anywhere (NFR-7), and that
downstream loops can feed on: the in-app review widget (ADR-025) and real Anki sync
(ADR-026). A dedicated private GitHub repository — a "learning vault" — is attractive:
free (NFR-8), versioned, readable/editable from any device, and a portable export by
`git clone`. Forces:

- **Token custody (§5.2):** any GitHub credential lives in platform env on the API host
  only — never in the client, never in the repo.
- **Availability (§2, NFR-4):** GitHub must not be on any read path; a GitHub outage may
  degrade the mirror, never a widget.
- **Module rules (§4.1):** several widgets save items; none may import another module.
  Cross-module effects ride the event bus; shared functionality needs one owner.
- **Data split (§4.3):** learning content is document-shaped → Mongo; anything the review
  widget schedules on is relational → Postgres (ADR-025). No cross-DB joins; compose in
  the API or the client.
- **Privacy (§5.3):** GitHub (Microsoft) becomes a processor for whatever we write there.
  Learning content is low-sensitivity; journal/mood are not and must never leak into it.

## Decision

We will add a `VaultModule` (NestJS domain module) owning a Mongo `vault_items` collection
and a GitHub write-behind pipeline. Every learning widget gets a "Save what I learned"
quick action that POSTs a **self-contained snapshot** of the item to the vault API.

### Repo layout & format

One private repo (name in `GITHUB_VAULT_REPO` env), created manually by Anna. One markdown
file per item, sharded by deck and month to keep directories browsable:

```
learning-vault/
├── japanese/2026/07/yakusoku-9f3a.md
├── tech/2026/07/ts-satisfies-operator-1c2d.md
└── README.md
```

Each file is YAML front-matter + a generated human-readable markdown body:

- **App-owned front-matter (never user-edited):** `id` (vault item uuid — the stable key
  used by ADR-025 cards and ADR-026 GUIDs), `deck: japanese | tech`, `created`,
  `source` (widget id, e.g. `japanese-wotd`), `schemaVersion`.
- **Anna-owned front-matter:** `tags: []` and a structured `fields:` block — the canonical
  machine-readable content (`expression/reading/meaning/example/exampleEn` for japanese;
  `question/answer/code/language/sourceUrl` for tech). ADR-025 and ADR-026 map from
  `fields`, never by parsing the body.
- **Body:** markdown rendered from `fields` for pleasant GitHub reading.
- **No SRS fields.** Review state lives in Postgres (ADR-025) and Anki keeps its own;
  scheduling state in git would mean a commit per review (rate-limit noise) and a second,
  contested source of scheduling truth. The vault is content, not state.

### Write path

API-side only, via a **fine-grained PAT** scoped to this single repo with Contents
read/write permission — least privilege, stored as `GITHUB_VAULT_TOKEN` platform env
(§5.2). The client never sees it and never calls GitHub. We use the **Contents API**
(`PUT /repos/{owner}/{repo}/contents/{path}`), **one commit per item** with messages like
`vault: add japanese/2026/07/yakusoku-9f3a.md (japanese-wotd)`. At personal save volume
(a handful/day against a 5 000 req/h limit) batching via the Git Data API
(blob→tree→commit) buys nothing and costs a four-call dance. Pushes run through a pg-boss
`vault.push` queue with **concurrency 1**, which serializes commits (avoids non-fast-forward
races and GitHub's secondary rate limits on concurrent writes).

### Source of truth & conflicts

**Mongo `vault_items` is the system of record; GitHub is a durable, portable mirror**
(write-behind). Rationale: every read path (widgets, review queue composition, Anki
mapping) hits our own DB — inside NFR-2 and immune to GitHub outages/rate limits; writes
succeed instantly with the mirror catching up async, exactly the ADR-005 queue pattern.
The mirror still delivers the point: `git clone` is the export (NFR-7), history is free,
and Anki sync reads the same `fields` via the API.

Anna editing files directly on GitHub is supported, not fought: a low-frequency worker job
(`vault.reconcile`, e.g. every 6 h + on-demand) compares the repo's latest commit against
the last synced SHA, pulls files changed by non-app commits, and imports Anna-owned parts
(`fields`, `tags`, body) into Mongo — **her manual edit wins for those**. App-owned
front-matter is restored if damaged. If both sides changed since last sync, GitHub wins
for Anna-owned fields and the item is flagged `conflicted` for review in the widget —
flag, don't silently merge. The app never blind-overwrites: each push sends the expected
blob `sha`; a 409 mismatch routes through reconcile first.

### Failure handling

`POST /vault/items` writes Mongo synchronously and enqueues `vault.push`. Items carry
`gitStatus: pending | pushed | failed | conflicted` plus `gitPath`/`gitSha`. The job is
idempotent (keyed on item id + content hash) with exponential backoff per ADR-005; after
exhausting retries the item stays `failed` and a periodic sweep re-enqueues any
`pending`/`failed` items (also covering a crash between Mongo write and enqueue — Mongo
writes can't share a Postgres transaction with pg-boss). GitHub being down therefore
degrades the mirror only; saving, reviewing, and Anki sync are unaffected.

### API contract

Under `/api/v1/vault`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007):

- `POST /items` `{ clientRequestId, deck, source, fields, tags }` → 201; replays of the
  same `clientRequestId` return the existing item (200) — ADR-011's idempotency pattern.
- `GET /items?deck=&tag=&ids=&q=` / `GET /items/:id` — list/fetch (ids-batch serves
  ADR-025's frontend composition).
- `PATCH /items/:id` (fields/tags edits → re-push), `DELETE /items/:id` (Contents API
  delete; git history retains the content).
- `GET /status` → `{ pendingPushes, failedPushes, lastPushAt, conflictedCount }`.

Saving emits `vault.item_saved { userId, itemId, deck, source }` on the event bus:
ADR-025 creates the review card from it; automations can react. No streak is credited
here — the source widgets already emit their own studied/completed events (ADR-011/013),
and double-crediting the same act is wrong.

**Privacy rules (hard):** the repo is private and holds only explicit "save what I
learned" payloads. Never written: journal/mood/appreciation content, tokens, push
subscription data, email addresses, or anything from non-learning modules. Push
notification bodies never quote vault content (§5.2 posture). Cost: €0 — private repos
and API use are free (NFR-8).

## Consequences

- **Easier:** one save action serves three consumers (vault file, review card via event,
  Anki note via ADR-026's deterministic mapping keyed on `id`); export is `git clone`;
  GitHub outages are invisible to the app; Anna can garden her notes in any git client.
- **Harder / committed to:** we own a reconcile protocol and must test it (sha mismatch,
  both-sides-changed, damaged front-matter); `fields` schemas per deck are now sticky
  (schemaVersion stamped for migrations); snapshots denormalize content — a later fix to
  a `jp_content` example does not propagate to saved items (accepted: the vault records
  what Anna actually learned).
- **Security surface:** one fine-grained PAT with single-repo Contents scope; it expires
  (GitHub forces ≤1 y) — token rotation goes in the runbook. Compromise of the API host
  exposes learning notes only, not the rest of GitHub.
- **Open questions for Anna:** third deck for free-form quick notes (`notes/`) or keep the
  enum at two? Preferred file naming (slug source: expression vs meaning)? Reconcile
  cadence — is 6 h fresh enough for her GitHub-side edits?

## Alternatives considered

- **GitHub as the system of record (API reads from the repo):** rejected — puts an
  external service, its rate limits, and its latency on every widget read (NFR-2, §2
  failure posture), and makes the review queue depend on GitHub uptime. Mirror-out keeps
  all the durability with none of the coupling.
- **GitHub App instead of a fine-grained PAT:** more rotation-friendly, but app
  registration + installation tokens + JWT signing is real ops surface for a single-user
  writer (G2). PAT with single-repo scope is proportionate; revisit if multi-user ever lands.
- **Client-side GitHub writes (token in browser):** rejected outright — violates §5.2
  token custody; a dashboard XSS would hand over the repo.
- **Git Data API with batched/debounced commits:** rejected — four API calls per commit
  and a batching window that risks losing queued items on crash, to optimize a rate limit
  we use <1 % of. One-commit-per-item is also a truthful history.
- **One big JSON/JSONL file per deck:** rejected — merge conflicts on every concurrent
  edit, unreadable diffs, and Anna can't comfortably edit one item on github.com.
  File-per-item is the whole point of using a repo.
- **Storing SRS state in front-matter:** rejected — commit noise per review, constant
  reconcile conflicts, and it contradicts §4.3 (review state is relational, queryable —
  Postgres, ADR-025).
- **Obsidian-vault-in-Git / third-party sync services:** rejected — nothing to integrate
  server-side (Obsidian is an editor, not an API), and paid sync violates NFR-8. The
  chosen format stays Obsidian-openable anyway (markdown + front-matter).
