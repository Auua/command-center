# ADR-024: GitHub learning-center repo — the store for learning content and cards

- **Status:** Accepted
- **Date:** 2026-07-16 (rewritten; the 2026-07-14 draft — "GitHub learning vault" — made Mongo
  `vault_items` the system of record with GitHub as a write-behind mirror. Product-owner decision:
  **no Mongo for learning data, GitHub is the store.** This rewrite records that.)
- **Review:** claude-reviewed — PO-reviewed

## Context

The learning widgets require three capabilities: bringing new content in (a Japanese word of
the day, later tech lessons), importing _existing_ content from the user's Anki decks, and
writing saved cards to a store that syncs onward to Anki (ADR-026). The requirement is that
all learning data live in one user-owned place that is readable, editable, and clonable
anywhere: a **separate private GitHub repository, `learning-center`** — versioned, browsable,
free (NFR-7, NFR-8).

The first draft interposed Mongo as the system of record with a write-behind queue and a
reconcile job, to keep GitHub off the read path. That trade was rejected: at single-user
volume the mirror machinery (queue, sha-conflict handling, reconcile, `gitStatus` lifecycle)
is more system than the problem, and a cached read through the Contents API is plenty. The
forces that survive unchanged:

- **Token custody (§5.2):** any GitHub credential lives in platform env on the API host only —
  never in the client, never in a repo.
- **Module rules (§4.1):** widgets don't import each other; one module owns the repo access.
- **Privacy (§5.3):** GitHub (Microsoft) processes whatever we write there. Learning content
  is low-sensitivity; journal/mood/appreciation content must never land in this repo.
- **Cost (NFR-8):** private repos and Contents-API use are free.

## Decision

We will add a **`LearningModule`** (NestJS) that reads and writes the `learning-center` repo
directly via the **GitHub Contents API** — no Mongo collection, no queue, no mirror. The repo
is the single source of truth for learning data.

### Repo layout

```
learning-center/
├── pool/japanese/manifest.json      # schemaVersion, pinned upstream release tags,
│                                    #   shard list, count, attribution block (ADR-032)
├── pool/japanese/words-000.jsonl …  # ~500 words/shard, ~2000 total, from jmdict-ingest
├── progress/japanese-wotd.json      # per-kind user progress (current/seen/skipped) —
│                                    #   written by the API; grammar/tech/system-design
│                                    #   files land with their kinds (ADR-012/013/019)
├── cards/japanese/2026/jp-1590480.md         # saved cards, sharded by save year
├── cards/japanese/imported/2019/…            # existing-deck import (ADR-026), sharded by
│                                             #   note-creation year (Anki noteId = epoch ms)
├── sync/state.json                  # written only by the anki-sync Action (ADR-026)
└── .github/workflows/anki-sync.yml  # thin caller workflow, committed once (ADR-026)
```

Sharding is deliberate: JSONL shards stay under the Contents API's 1 MB response comfort
zone, and year directories stay under GitHub's 1 000-entry listing truncation. Everything is
human-editable on github.com — that is a feature, not a risk to reconcile away. The flip side
is specced, not assumed: consumers validate card files against the shared schema and
**skip + report** malformed ones — the API ignores them, and ADR-026's sync run records them
in `state.json.errors` and carries on. A hand-edit can break one card, never the feature.

### Card file format

One markdown file per card: YAML front-matter (the machine-readable truth) plus a generated
body for pleasant GitHub reading. Front-matter: `id` (deterministic `jp-<JMdict ent_seq>` —
the stable key ADR-026's notes and guids derive from), `deck` (`japanese` | `tech`), `source`
(widget id or `anki-import`), `created`, `anki: true` (Anki-bound; ADR-026 syncs only flagged
files), `fields` (`expression`, `reading` in Anki bracket furigana — folded at ingest so no
downstream code touches Japanese text, `meaning`, `example`, `exampleEn`), `tags`, and a
`license` block naming the source dataset. Consumers map from `fields`, never by parsing the
body. **No SRS/scheduling state in files** — Anki owns its schedule; a commit per review
would be noise (unchanged from the first draft).

### Content pool: seeded JMdict subset (with ADR-032)

New Japanese content is **not** a runtime API: a repo tool (`tools/jmdict-ingest`,
TypeScript) downloads **pinned** jmdict-simplified (`jmdict-examples-eng`, which bundles
Tatoeba example sentences) and JmdictFurigana release artifacts, filters to a frequency-led
subset (priority `ichi1`/`nf01–nf12`, must have a furigana alignment and an English gloss,
archaic/obscure senses dropped, top ~2000), folds furigana to bracket notation, and emits the
manifest + shards. The user runs it against a local clone and commits the output — bumping a pin
is a reviewed commit, per ADR-032's stance. The manifest's attribution block carries EDRDG's
required acknowledgement line, which the widget renders on every word display (ADR-032: a
legal requirement, not styling). **Tech lesson content is deferred** — no open-licensed
dataset exists; sourcing (APIs, datasets, scraping with ToS/licence assessment) is an open
investigation recorded in ADR-032.

### API access, caching, and the read path

Env pair (both or neither; without them the app boots and the widget shows "not
configured"): `GITHUB_LEARNING_REPO` (`owner/name`) and `GITHUB_LEARNING_TOKEN` — a
**fine-grained PAT scoped to this single repo with Contents read/write only** (§5.2; ≤1 y
expiry, rotation in the runbook). The client never sees it and never calls GitHub. The
GitHub client is plain `fetch` (four endpoints; no Octokit dependency).

GitHub sits on the read path **behind a cache, never behind a spinner**:

- the pool loads into API memory (manifest + shards), TTL ~6 h, refreshed with conditional
  requests (ETag → 304). Each refresh is **pinned to a single commit** — resolve the repo's
  current SHA once, then fetch manifest and shards at `?ref=<sha>` — so a pool push landing
  mid-refresh can never mix manifest and shard versions; on any GitHub error the API
  **serves the cached pool indefinitely**
  — an outage means a stale word while the process holds a cache. The cache is process
  memory only: after a cold boot during an outage there is no pool, and the endpoint
  returns an explicit unavailable state that the widget renders as "couldn't load — try
  again later" with a retry (product-owner decision 2026-07-17: WOTD is not crucial enough
  to buy a disk snapshot or boot-warming machinery);
- `sync/state.json` is cached ~60 s for the Anki status surface (ADR-026);
- writes (`PUT` a card file) are synchronous and idempotent by construction: the path is
  deterministic from the card id, so a retried save finds the file and reports
  `alreadyExisted` instead of erroring. A failed write is shown honestly with a retry — at
  one-user save volume, an in-flight loss costs one button press, not a durability story;
- **credential failures are not outages:** a 401/403 from GitHub (expired or revoked PAT)
  never hides behind serve-stale — `GET /wotd` and `GET /anki-status` flip to an explicit
  token-invalid state, so the first symptom is a labelled card, not a save failing months
  after the pool went quietly stale. The PAT's ≤1 y expiry gets a dated rotation reminder
  in the runbook.

### Per-kind progress: `progress/<kind>.json`

Per-user progress lives in the repo too — **one JSON file per card kind**
(`progress/japanese-wotd.json` in v1; `grammar`, `tech`, `system-design` land with their
kinds), written only by the API. Progress is deliberately a **separate file from the pool**:
the pool is machine-generated content, wholesale re-emitted by ingest; progress is user
state a pool regeneration must never touch. Each kind's schema is owned by its widget ADR;
for WOTD the file holds `{ current: { date, id }, skipped: [id …], seen: { id: date } }`:

- **selection:** eligible = pool − `skipped` − `seen`; the day's pick is a date-seeded hash
  over the eligible set (`?date=YYYY-MM-DD` supplied by the client — the server never
  guesses timezones), pinned in `current` and marked `seen` on the first serve of the day —
  one commit per day. No repeats until the whole pool has been seen; then `seen` resets and
  a new cycle starts (`skipped` persists).
- **skip** ("I know this one"): adds the current word to `skipped` and immediately pins the
  next eligible pick — a replacement word right away, one commit.
- **writes are sha-guarded:** a concurrent write (two devices at day rollover) refetches,
  reapplies, and retries; both converge on the same deterministic pick.
- **hand-editable like everything else** (un-skip a word by deleting its line); a malformed
  progress file is skipped + reported like a malformed card, and the API degrades to a
  progress-less pick rather than a broken widget.

Progress commits touch `progress/**` only and never trigger the anki-sync workflow (its
push trigger is path-filtered to `cards/**`, ADR-026).

### API contract

Under `/api/v1/learning`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007):

- `GET /wotd?date=YYYY-MM-DD` → `{ configured: false }` |
  `{ configured: true, date, word, attribution, saved, cardPath? }`
- `POST /wotd/skip` `{ date }` → the same shape with the replacement word — adds the
  current pick to `skipped`, pins the next eligible pick (one commit).
- `POST /cards/:kind` `{ itemId, date? }` → `{ cardId, path, htmlUrl, alreadyExisted }` —
  **one request contract for every card source; the path carries the kind**
  (`japanese-wotd` in v1; `grammar`, `tech`, `system-design` land with their widgets). A
  server-side formatter per kind resolves `itemId` against that kind's content source and
  derives the card id, deck, and `fields` — the client never sends card content, and a new
  source is a formatter registration, not a contract change. Writes the card file with
  `anki: true`; the commit is what triggers Anki sync (ADR-026).
- `GET /anki-status` → composed from `sync/state.json` + a commits count (ADR-026).

## Consequences

- **Easier:** one store — no dual-write, no drift, no queue/reconcile machinery to test; the
  export _is_ `git clone`; cards can be gardened in any git client and the app simply reads
  the current state; sync results (`state.json`) version alongside the cards they describe;
  the whole learning feature adds zero database surface.
- **Harder / accepted:** GitHub is on the read path — bounded by in-memory caching,
  conditional requests, and serve-stale-forever degradation; the felt worst case is a stale
  word (or, cold-booted mid-outage, a "try again later" card) and a save button that errors
  until GitHub returns. Rate limits (5 000 req/h) are
  three orders of magnitude above actual volume. If this ever hurts in practice, the first
  draft's cache-in-a-DB design is the known escape hatch — revisit then, not preemptively.
- **Progress-in-repo costs commits:** roughly one a day per active kind (day pin + seen)
  plus one per skip or completion — accepted as the price of memory with no database.
  Per-review SRS state stays rejected (ADR-025/026): that volume would be noise.
- **Security surface:** one fine-grained PAT, single repo, Contents-only. Compromise of the
  API host exposes learning notes only.
- **Privacy rules (hard, unchanged):** the repo holds only learning content. Never written:
  journal/mood/appreciation content, tokens, subscriptions, addresses.
- **Supersedes:** the 2026-07-14 draft's `VaultModule`, Mongo `vault_items`, `vault.push`
  queue, reconcile job, `vault.item_saved` event, and `/api/v1/vault/*` endpoints — none will
  exist. ADR-025, which composed against those, was rejected on 2026-07-17 —
  Anki is the only SRS. ARD edits owed on approval: §4.3 loses the planned `vault_items` row;
  the ADR-024 summary row.
- **Open questions for the product owner:** (1) repo name literally `learning-center`? (2) Is a ~2000-word
  pool the right starting size? (3) When tech lessons land, same repo under `pool/tech/` +
  `cards/tech/` (the design assumes yes)?

## Alternatives considered

- **Mongo as system of record + GitHub write-behind mirror (the 2026-07-14 draft):** rejected
  by product-owner decision — the queue, sha-conflict routing, reconcile job, and dual-source-of-truth semantics
  are real machinery bought to keep an external service off a read path that a cache covers at
  this scale. Kept as the documented escape hatch if GitHub-on-the-read-path ever hurts.
- **GitHub as record, DB as read-through cache:** rejected for v1 — same freshness questions
  as the mirror with an extra store to keep warm; in-memory caching gives the same read
  protection for free.
- **Client-side GitHub writes (token in browser):** rejected outright — violates §5.2 token
  custody; a dashboard XSS would hand over the repo.
- **A GitHub App instead of a fine-grained PAT:** more rotation-friendly, but registration +
  installation tokens + JWT signing is real ops surface for a single-user writer (G2). PAT
  with single-repo scope is proportionate.
- **One big JSON/JSONL file per deck for cards:** rejected — merge conflicts, unreadable
  diffs, and the user can't comfortably edit one card on github.com. File-per-card is the point
  of using a repo. (The _pool_ is JSONL shards because it is machine-generated and re-emitted
  wholesale by the ingest tool — diffs there are per-release, not per-item.)
- **Runtime dictionary API for new content:** rejected (ADR-032) — no terms of service on the
  obvious candidate (Jisho's unofficial API, whose data _is_ JMdict), and an external
  dependency on every read for data that a pinned, licensed artifact provides offline.
- **Folders-as-state for progress (`seen/` / `skip/` / `show/` directories):** rejected —
  it forces file-per-word (the pool is JSONL shards), the Contents API has no atomic move
  (a move is delete + create, two commits), and pool regeneration would have to reconcile
  every word's current location — the mirror machinery this rewrite deleted. A per-kind
  progress file gives the same repo-visible, hand-editable state in one-line diffs.
- **Storing SRS state in front-matter:** rejected — a commit per review, and it contests
  Anki's ownership of its own schedule (ADR-025/026).
- **Obsidian-vault-in-Git / third-party sync services:** rejected — nothing to integrate
  server-side, and paid sync violates NFR-8. The format stays Obsidian-openable anyway.
