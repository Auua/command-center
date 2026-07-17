# ADR-026: Anki two-deck sync (Japanese + Tech) — learning-repo GitHub Action → AnkiWeb

- **Status:** proposed
- **Date:** 2026-07-16 (rewritten twice: the 2026-07-14 draft used AnkiConnect
  queue-and-flush; the same-day revision then dropped Mongo with ADR-024 — GitHub is the
  store, and sync results live in `sync/state.json` instead of a report endpoint)
- **Review:** claude-reviewed — pending product-owner approval

## Context

Two live Anki decks — **Japanese** and **Tech** — must stay available on every device.
That last part is not ours to build: AnkiWeb already syncs a collection to Anki's mobile and
desktop clients. What we must build is everything upstream of it — turning saved card files
(ADR-024) into well-formed notes in the right deck, without duplicates, and showing the user
honestly whether that has happened.

The first draft of this ADR (and ADR-011 before it) reasoned from a two-option premise:
AnkiConnect is a plugin inside the _desktop_ Anki app on `localhost:8765` that a cloud backend
can never reach, and AnkiWeb has no public API and scraping it is forbidden (ToS, R2) —
therefore the only path to the collection runs through the user's browser while desktop Anki is
open, hence queue-and-flush. **That premise missed a third option.** The official `anki`
package on PyPI is not a wrapper or a reverse-engineered client — it is the actual Anki
backend, the same code the desktop app runs. It can open a collection, add and update notes,
and sync with AnkiWeb through the official protocol (`sync_login` → `sync_collection`). This
is the sanctioned way to script Anki, categorically different from scraping AnkiWeb's HTML.

Running that library needs three things: a place to execute Python, the card content, and
AnkiWeb credentials. ADR-024 already puts the content in a private GitHub repo, one commit per
saved item — which means GitHub Actions is a runner that fires exactly when cards change, with
encrypted secrets storage in the user's own GitHub account, for free (NFR-8). The desktop app
drops out of the loop entirely: it becomes just another AnkiWeb client, like the phone.

This approach was selected over the desktop-mediated one by product-owner decision; this
rewrite records it. Nothing of the old design is implemented, so nothing is migrated.

## Decision

### Sync engine: a workflow in the learning repo, machinery in the monorepo

The learning repo is a **separate GitHub repository** from the command-center monorepo
(ADR-024), so "ship a workflow there" needs a distribution mechanism — the app cannot pretend
that repo is part of its own deployable. Split by rate of change:

- **The learning repo carries only a thin caller workflow** (`.github/workflows/anki-sync.yml`,
  ~15 lines: the triggers and concurrency below plus one `uses:` step). The user commits it **once
  at setup**, exactly like the repo itself, which ADR-024 already specifies as manually created. It
  almost never changes afterwards.
- **The machinery lives in the command-center monorepo** as a composite action —
  `tools/anki-sync/` holding `action.yml`, the Python sync script, and the pinned
  `anki==X.Y.Z` requirement. The caller references it as
  `uses: <owner>/command-center/tools/anki-sync@anki-sync-v1`; the runner downloads the action
  bundle directly, so no PAT and no cross-repo checkout are needed. The one switch to flip:
  the command-center repo's Actions access setting must allow its actions to be used from the
  owner's other private repositories (GitHub's same-owner private-Actions sharing).
- **Releases are the `anki-sync-v1` tag moving** — script and `anki` library version travel
  together, and a sync run never changes behavior because command-center's `main` moved.
  Bumping the tag is the deliberate act the pinned-version policy (below) calls for.

AnkiWeb credentials stay **learning-repo Actions secrets**, passed into the action as inputs —
the monorepo holds code, never secrets. Triggers, on the caller:

- **`push`** filtered to `cards/**` — every saved or edited card syncs within minutes, from
  any device, desktop off. (The filter matches ADR-024's layout; `progress/**` and `sync/**`
  commits never trigger a run.)
- **`schedule` (daily)** — reviews done on mobile change stats without any commit, so the
  snapshot (below) refreshes at least daily; and a daily run turns sync-protocol drift into a
  red run within a day instead of a silent failure months later.
- **`workflow_dispatch`** — manual re-run from the Actions tab.

A `concurrency: anki-sync` group (no cancel-in-progress: never kill a run mid-sync) is the
politeness mechanism: GitHub holds at most one pending run per group, so ADR-024's
one-commit-per-item bursts coalesce into at most a running run plus one queued run. Combined
with personal save volume (a handful of pushes a day) and the single daily cron, AnkiWeb sees
a polite client, never a polling loop.

Run steps, in order — the order is load-bearing:

1. Restore `collection.anki2` from `actions/cache` (optimization only; a miss is normal).
2. `col.sync_login(email, password)` with `ANKIWEB_EMAIL` / `ANKIWEB_PASSWORD` from Actions
   secrets, then **sync down** (`sync_collection`). On a cache miss the empty collection
   full-downloads — slower, equally correct. Writing before syncing down is forbidden: it
   manufactures full-sync conflicts with the user's mobile reviews.
3. Ensure decks and note types exist (`col.decks.id()` creates on demand; models by name →
   create). A missing model is the normal state of a fresh runner, not an error.
4. Upsert a note for **every** card file with `anki: true` (below), keyed on `CardId`. Every
   file, every run — convergence by re-derivation, not by tracking deltas. A file that fails
   front-matter validation is **skipped and recorded** in `state.json.errors` — one
   hand-edited card never fails the run (product-owner decision 2026-07-17).
5. **Sync up** (`sync_collection` again), then `col.close()`.
6. Report results and stats to the API (below).

**Full-sync rule (the one dangerous edge):** if Anki decides the collections have diverged
beyond normal merge (schema change, long divergence), the script may answer **full download**
(we only lose the cache) but must **never answer full upload** — a CI runner force-uploading
over the user's real collection could destroy mobile review history. Full-upload-required fails
the run red, and the user resolves it once on a real client.

### What gets synced: the `anki` front-matter flag

**"Add to Anki" is a repo write, not an Anki API call.** Saving a card
(`POST /api/v1/learning/cards`, ADR-024) creates the card file with `anki: true` already in
its front-matter — in v1 every saved card is Anki-bound, so saving _is_ adding to Anki. The
commit triggers the workflow. There is **no `anki_queue`**, no flush protocol, and no
browser↔Anki traffic of any kind — the repo _is_ the queue. The flag still earns its place:
the sync script upserts only `anki: true` files, so a future not-for-Anki card class (or the user
flipping the flag off in any git client) needs no new mechanism.

**Every Anki note is created from a card file** — structurally: the sync script can only see
the repo, so no path can produce a note without a file. The card's `id` is the identity that
makes the note addressable, deduplicable, and re-mappable forever.

### Import: getting the existing decks in

The user's real decks predate this system, so the Action has a second, dispatch-only mode
(`workflow_dispatch` input `mode: import`): sync down → export every note of the configured
deck whose guid does _not_ start with `cc:` into `cards/japanese/imported/<year>/` files
(year derived from the Anki note id, which is a creation-epoch-ms) → commit → **stop**. Import
never syncs up — it is read-only against the collection by construction. Imported files carry
`source: anki-import` and an `anki: { noteId, guid, model }` block, and their `fields` are a
raw 1:1 map of the source note type's field names, so later edits write back to the same model
losslessly. Subsequent sync runs upsert them by the stored `noteId` and never duplicate them.

### Deck & note-type design

**Two top-level decks, named in settings** (defaults `Japanese`, `Tech`), mapped 1:1 from the
card's `deck` field (`japanese` | `tech`). **The Tech deck is deferred with its content track
(ADR-013/032 investigation pending); v1 ships Japanese only**, but the design is two-deck so
Tech lands as content plus one deck mapping, not a new mechanism. **No subdecks.** Anki applies its scheduling
options and daily limits per top-level deck, which is exactly the granularity the user asked for;
sub-classification (WOTD vs grammar, TypeScript vs SQL) rides as **tags** — `cc::japanese-wotd`,
`cc::grammar`, `cc::tech::typescript` — which filter and search just as well without multiplying
deck config. The `cc::` prefix keeps our tags from colliding with the user's own.

Two **custom note types**, created by the sync script, name-versioned so a field change is a
new model and never a destructive migration of the user's existing notes:

| `CC Japanese v1`                      | `CC Tech v1`                       |
| ------------------------------------- | ---------------------------------- |
| `Expression` (first field)            | `Question` (first field)           |
| `Reading` — furigana bracket notation | `Answer`                           |
| `Meaning`                             | `Code` (pre-formatted, in `<pre>`) |
| `Example`, `ExampleEn`                | `Language`                         |
| `Source`                              | `SourceUrl`                        |
| `CardId`                              | `CardId`                           |

Identity is double-anchored, both anchors ours to set (the library, unlike AnkiConnect,
exposes both), and **deterministic from the content source** — `jp-<JMdict ent_seq>`, not a
random uuid, so a replayed save converges on the same file, note, and guid:

- **`CardId` field** — the searchable, human-visible identity; the upsert queries
  `"CardId:<id>"` via `find_notes`.
- **Anki's note `guid`**, set deterministically to `cc:<card-id>` at creation — Anki's own
  sync- and import-level dedupe now recognizes our notes natively. (The previous draft
  rejected guid because AnkiConnect's `addNote` cannot set it; the official library can.)

**Furigana** uses Anki's native convention, and the conversion happens at **ingest time**: the
pool's `reading` field (ADR-024) already holds bracket notation (`約束[やくそく]`), folded by
jmdict-ingest from JmdictFurigana alignments, so card files are legible on their own and the
card template just renders `{{furigana:Reading}}`. Neither the API nor the Python mapper ever
touches Japanese text.

Card templates ship with the model: Japanese generates recognition (Expression → Meaning) and,
optionally, recall (Meaning → Expression) cards; Tech generates one card (Question → Answer +
Code). Card files store `code` raw (readable in GitHub); the sync script HTML-escapes it and
wraps it in `<pre>` at note-build time — Anki templates are HTML, and un-escaped code in a
card is both broken rendering and a (self-inflicted) injection.

### Mapping & idempotency

Mapping reads ADR-024's structured `fields` block, **never the markdown body**. With furigana
folded at write time and escaping specced above, the map is a near-verbatim field copy —
deliberately too dumb to drift. It lives in the sync script under `tools/anki-sync/`, with
golden-file tests per deck in the same directory, run by the monorepo's normal CI — the mapper
sits two directories from `packages/contracts`, not in another repo. The honest cost that
remains: it is Python next to a TypeScript codebase; `contracts` keeps only the `fields`
schema (ADR-024's), which is the actual contract.

Idempotency, three layers:

1. **`find_notes` on `CardId`** (or the stored `noteId` for imported cards) — hit →
   `update_note`, miss → `add_note`. Exact, and it survives the user editing the expression.
2. **Deterministic `guid`** — even against a rebuilt collection or a stray import, Anki's own
   machinery refuses a duplicate of `cc:<card-id>`.
3. **Anki's first-field duplicate check** as the final net.

The previous draft's `clientRequestId` layer disappears with the queue it protected: the
workflow reads repo _state_, not a request stream, so re-running — including replaying every
card file, which every run does — converges by construction. A crash between `add_note` and
sync-up loses nothing: the next run finds the note absent from AnkiWeb and re-adds it under
the same guid.

**Deletions are manual.** Unsetting `anki: true` or deleting a card file never deletes or
alters the existing Anki note — scheduling history is expensive to rebuild and cheap to keep.
The script only creates and updates; removing a card is an act the user performs in Anki.

### Reporting back: `sync/state.json`, not an endpoint

The run's last step **commits a state file to the learning repo itself** —
`sync/state.json`, written only by the Action (default `GITHUB_TOKEN`, job permission
`contents: write`; the push trigger is path-filtered to `cards/**`, so this commit cannot
retrigger the workflow). No report endpoint, no machine bearer token, no `anki_snapshots`
store — with GitHub as the store (ADR-024), sync results are just more repo state. Contents:

- `lastSyncAt` and `lastRun { runId, mode, status, url }`;
- per-card results: `{ ankiNoteId, action: created | updated | unchanged | failed, syncedAt }`
  keyed by card id;
- per-deck stats computed from the just-synced collection: card counts by state, due today,
  reviews done today — fresher than any desktop session (every push plus daily, desktop off);
- `errors` for anything non-fatal worth surfacing.

The API reads this file (ETag-cached) to serve the status surface. The `srs_owner` hinge to
the in-app review widget (ADR-025) is **deferred with that widget**; when it lands, ownership
transfer keys off `state.json`'s per-card results instead of a pushed event — same one-item,
one-scheduler invariant, different transport.

The collection is fully readable during a run, so a per-card schedule import into ADR-025's
FSRS is now _possible_ — it remains **rejected**, on ADR-025's own grounds (a partial import
silently corrupts FSRS state; ownership transfer is one-way), no longer on reachability
grounds. A run that syncs but crashes before committing state merely leaves `lastSyncAt`
stale until the next run; the Actions tab is the ground truth the status surface links to.

### "Synced for me": the status surface

Three honest states, surfaced in the learning widget's footer:

- **Synced** — "Anki synced 8 min ago" (relative time from `lastSyncAt`,
  `Intl.RelativeTimeFormat`).
- **Pending** — "N waiting for sync": card commits since `lastSyncAt` (a cheap commits-list
  query on `cards/`, excluding the Action's own commits — concretely, commits authored by
  `github-actions[bot]` are filtered out, so the counter can honestly reach zero). The
  normal window is a couple of
  minutes — commit, run, state — on **any** device. The old design's "pending possibly for
  days until desktop Anki opens" state no longer exists.
- **Failed** — `state.json` marks the run or an item `failed`. "View run" links to the
  Actions tab; retry is re-running the workflow there (or any new card commit).

No spinner implying live connectivity, and — new — a green tick on mobile is now _true_, which
the old design structurally could not offer.

### API contract

No Anki module exists at all — Anki sync has no API surface beyond one read. The
`LearningModule` (ADR-024) exposes, alongside its content endpoints:

- `GET /api/v1/learning/anki-status` →
  `{ configured, lastSyncAt, lastRunStatus, lastRunUrl, pendingCommits, decks }` — one fetch
  for the surface above, composed from `state.json` plus the commits query, both cached.

Gone: the first draft's `POST/GET/PATCH /api/v1/anki/queue`, `PUT /snapshot`, and this
rewrite's earlier `PUT /report`; `/api/v1/japanese/anki/*` (ADR-011/013). "Add to Anki" rides
ADR-024's `POST /api/v1/learning/cards` — no Anki-specific write endpoint exists for the
client at all.

### Credential custody & terms

AnkiWeb email + password live **only** in Actions secrets of the user's own private repo —
encrypted at rest, masked in logs, never on our API host, never in the client (§5.2). The
script must still never print sync responses. Blast radius of a leak: read/write of the Anki
collection — the same power as the desktop login it replaces. The API's learning-repo PAT
(ADR-024, `GITHUB_LEARNING_TOKEN`) is unchanged: Contents-only, single repo.

On terms: this is the official client library speaking the official sync protocol,
authenticated as the account owner, at personal-use volume. The previous draft's rejection of
"AnkiWeb scraping" (HTML, ToS) stands untouched — this is not that.

## Consequences

- **Easier:** the desktop app leaves the architecture — a card saved on the phone is in
  AnkiWeb minutes later, with desktop Anki closed or the machine off. The API loses a whole
  protocol surface (queue endpoints, flush lifecycle, AnkiConnect CORS carve-out, client
  provisioning); the browser never talks to Anki. Stats refresh daily regardless of desktop
  use. Re-syncing every card file is the normal case, not a recovery mode. Existing decks
  come in through the same machinery (import mode), not a separate tool.
- **Harder / committed to:** we own a Python sync script in a TypeScript monorepo, plus a
  cross-repo seam: the learning repo's caller workflow, the monorepo's Actions-sharing setting,
  and the `anki-sync-v1` release tag are three pieces of setup that live outside the codebase
  and belong in the runbook. The pinned `anki` version needs deliberate bumps (the sync
  protocol evolves and old clients get rejected; the daily run is the alarm) — shipped by
  moving the tag, so a bad bump is rolled back by moving it back. GitHub Actions is now on
  the sync path: an Actions outage delays sync but loses nothing — the repo still holds the
  items. The Actions secret must be updated after any AnkiWeb password change.
- **Still owned from the first draft:** custom note types and card templates in the user's
  collection — a field change means shipping `CC Japanese v2` and leaving v1 notes alone;
  versioned model names are what make that survivable. The HTML-escaping obligation on `Code`.
- **The full-sync edge:** the script's never-full-upload rule is the single most important
  line of the implementation and gets a test. A red run here is correct behavior, not a bug.
- **Supersedes:** ADR-011's entire queue-and-flush protocol (durable `anki_queue`, browser
  `ankiConnectClient`, flush-time provisioning, client stats push) and its
  `/api/v1/japanese/anki/*` endpoints; ADR-013's reuse of that endpoint; this ADR's own
  2026-07-14 draft (AnkiConnect flush + desktop `sync` trigger); and, from the 2026-07-16
  revision (product-owner decision: GitHub is the store, no Mongo), the interim `PUT /api/v1/anki/report`
  endpoint, its machine token, `AnkiModule`, and the Mongo `anki_snapshots` collection —
  none of these will exist. ADR-019 and ADR-024/025 are edited in place (same unapproved
  batch). ARD edits owed on approval: §4.5's Anki paragraph, the container diagram and
  failure-mode row, the AnkiConnect CORS row, R2, Phase 3's "queue-and-flush", and §4.3's
  `anki_snapshots` row (deleted, not moved).
- **Media** (images/audio, e.g. ADR-019's diagrams) stays out of v1; when wanted it is one
  more call in the same run (`col.sync_media`), not a new architecture.
- **Open questions for the product owner:** (1) Recall (Meaning → Expression) cards for Japanese: on or
  off by default? (2) Deck names — literally `Japanese` and `Tech`, or nested under an
  existing parent deck? (3) Comfortable with the AnkiWeb password in Actions secrets, or gate
  this ADR on trying it with a throwaway AnkiWeb account first? (The "do the decks already
  have content" question is answered: yes — import mode exists for exactly that.)

## Alternatives considered

- **AnkiConnect queue-and-flush via the browser (this ADR's first draft, per ADR-011):**
  workable but desktop-gated — adds pend for days until desktop Anki opens, stats lag by a
  desktop session, mobile can never show a true green tick, and we own a queue, a flush
  lifecycle, client-side provisioning, and a CORS carve-out. Kept in history as the fallback
  if credentials-in-Actions proves unacceptable.
- **Server-side AnkiConnect:** still impossible, not merely rejected — it binds to desktop
  localhost. Restated because it is the first thing everyone proposes.
- **AnkiWeb HTML scraping / reverse-engineered private endpoints:** still rejected on ToS
  grounds (R2). The official library speaking the official sync protocol is a different act.
- **Self-hosted Anki sync server, devices re-pointed at it:** rejected — takes custody of the
  entire collection on our infra (backups, availability, §5.3 exposure) and reconfigures every
  device, to replace a sync service Anki provides for free (NFR-8).
- **Generating `.apkg` files (genanki) on a schedule:** rejected — an `.apkg` does not import
  itself; it waits for a manual click in desktop Anki, which is the exact gap this redesign
  closes. Re-imports also carry scheduling-clobber risk that true sync does not.
- **Vendoring the whole script + workflow into the learning repo:** rejected — that repo has
  no CI of its own worth building, so the mapper's golden tests would drift away from
  `packages/contracts`, and every script fix becomes a manual copy into a second repo. The
  thin-caller/composite-action split keeps the code where the tests and reviews already are.
- **The API provisioning and updating the workflow via the Contents API:** rejected — writing
  under `.github/workflows/` needs the fine-grained PAT to gain the Workflows permission,
  widening ADR-024's deliberately Contents-only scope, to automate a ~15-line file that
  changes approximately never. One manual commit at setup is proportionate.
- **A report endpoint (`PUT /api/v1/anki/report` + machine token), as this rewrite first
  proposed:** rejected once Mongo left ADR-024 — it existed to fill `anki_snapshots`; with
  GitHub as the store, committing `sync/state.json` is simpler, keeps sync results
  versioned next to the cards they describe, and removes a token and an API surface.
- **Running the sync from our worker (pg-boss job):** rejected — puts AnkiWeb credentials on
  our API host (the custody objection the first draft rightly raised), adds a Python runtime
  to a Node deployment, and re-implements what Actions gives free: trigger-on-push, secrets,
  logs, cron.
- **A minutes-level cron instead of push-triggered runs:** rejected — hammers AnkiWeb for a
  personal repo that changes a few times a day; push triggers + daily schedule match actual
  write volume.
- **Keeping an API-side `anki_queue` in front of the card files:** rejected — a second queue
  duplicating repo state, adding no durability the repo doesn't already provide.
- **Anki's `guid` as the _only_ identity (no `CardId` field):** rejected — guid is invisible
  in the Anki UI and unsearchable by the user; the field costs nothing and is the debuggable
  handle. We set both.
- **Importing Anki's per-card scheduling state back into ADR-025's FSRS:** still rejected —
  now as a choice (the collection is readable in the run) rather than an impossibility; a
  partial import silently corrupts FSRS state, and ownership transfer stays one-way. (Import
  mode deliberately exports _content_ only, never scheduling.)
