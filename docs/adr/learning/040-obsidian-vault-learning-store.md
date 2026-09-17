# ADR-040: The Obsidian vault is the learning store — ADR-024's repo layout superseded

- **Status:** proposed
- **Date:** 2026-09-17
- **Review:** new
- **Supersedes:** ADR-024 §"Repo layout", §"Card file format", §"Content pool", §"Per-kind
  progress"; amends ADR-011, 012, 013, 019, 026, 032 and `docs/runbook-learning-center.md` as
  listed under Consequences. ADR-024's store decision (GitHub repo, no database, Contents API
  behind a cache, token custody, privacy rules) **stands**.

## Context

ADR-024 (accepted 2026-07-17) made the private `learning-center` GitHub repository the single
store for learning data and specified its layout: a machine-generated JMdict word pool in JSONL
shards (`pool/japanese/`), authored grammar files with English front-matter (`pool/grammar/`),
per-kind progress JSON written only by the API (`progress/<kind>.json`), one markdown file per
saved card (`cards/**`, flagged `anki: true`), and a sync-state file written by a GitHub Action.
ADR-011/012/013/019/026/032 and the learning runbook are all written against that layout. None of
it has been built: `tools/jmdict-ingest`, `tools/lesson-ingest`, and `tools/anki-sync` do not
exist, and the repo was never seeded.

Between 2026-08-29 and 2026-09-17 the product owner populated the `learning-center` repository
with something else: an **Obsidian vault**, Finnish-first, organised as a knowledge graph rather
than as an app's data directory. Its `Japanese/` area as of this ADR:

| Folder                          | Notes | `type`           | Front-matter that matters here                                                                 |
| ------------------------------- | ----: | ---------------- | ---------------------------------------------------------------------------------------------- |
| `30 Sanasto/Sanat`              | 7 959 | `vocab`          | `word`, `reading` (kana), `romaji`, `meaning` (FI), `pos`, `jlpt`, `kanji`, `sets`, `sources`  |
| `20 Verbit/Lekseemit`           | 1 460 | `verb`           | as vocab + `verbclass`, `transitivity`, `pair`; full conjugation table in the body             |
| `40 Kanji/Merkit`               | 1 112 | `kanji`          | `kanji`, `strokes`, `onyomi`, `kunyomi`, `meaning`, `components`, `lookalikes`                 |
| `10 Kielioppi/Pisteet`          |   317 | `grammar`        | `ja`, `reading`, `jlpt`, `func`, `attaches`, `compare`, `sources`                              |
| `50 Lauseet`                    |    81 | `sentences`      | example banks; each sentence carries a `^block-id` and is embedded elsewhere                   |
| `30 Sanasto/Setit`              |    64 | `set`            | themed vocabulary sets (Bases-driven)                                                          |
| `60 Lahteet`                    |    19 | `source`         | textbooks and sites; chapter headings link to the grammar points they teach                    |
| `90 Paivakirja/Loki`, `Virheet` |   2+2 | `log`, `mistake` | study log (`minutes`, `materials`, `focus`); mistakes (`topic`, `cause`, `recurring`, `fixed`) |

Every content note carries **`status: new | learning | shaky | known`**, **`confidence: 1–5`**,
and **`reviewed: YYYY-MM-DD`** — the vault's own progress model, read by its review dashboard
(`80 JLPT/Kertaus.md` over `00 Meta/Bases/Kertaus.base`: "weakest first", "not reviewed in 30
days", "recurring mistakes"). Every note also ends in a `## Kortit` section written in Obsidian
Spaced-Repetition syntax (`#flashcards/<kind>[/<level>]`, `Front::Back`, `Front:::Back`, or a
multi-line `?` card), and `00 Meta/Scripts/sr_to_anki.py` already exports those to an Anki TSV
with a stable sha1 UID per card and a `Japani (Obsidian)` note type. `00 Meta/Scripts/check_vault.py`
already parses the front-matter schema and validates required fields per `type`.

The vault is the user's primary learning surface — edited daily in Obsidian on desktop and
phone, auto-committed by the `obsidian-git` plugin ("vault backup: <timestamp>"). The command
center is to be a set of daily-prompt tiles over that surface, not a second one.

Forces:

- **The content is already there, and it is better content.** 9 400 words with Finnish and
  English glosses drawn from the user's own textbooks (chapter-linked), versus the planned
  ~2 000-word frequency slice of JMdict with English-only glosses. Sourcing (ADR-032's R5) is
  closed by ownership: the notes are the user's own, so the EDRDG attribution block and the
  pinned-release ingest exist to solve a problem the vault does not have.
- **The vault has a progress model and the ADRs have another.** `progress/<kind>.json` would
  track seen/skipped words in a file Obsidian never reads, while `status`/`confidence`/`reviewed`
  — the fields the vault's review views are built on — are set on almost no notes today
  (`reviewed` on 0 of 10 858, `confidence` at 1 on 10 750). Two progress models means the
  review dashboard in Obsidian stays empty forever. One model, written by the app, makes it work.
- **The vault has a card model and the ADRs have another.** 10 858 notes already have cards;
  writing a second `cards/**` tree with a different id scheme and note type would double every
  card in Anki.
- **Scale changes the read path.** ADR-024 sized its Contents-API cache for a handful of ≤1 MB
  shards. The vault is ~14 000 files; per-file reads at refresh time are not an option, and a
  1 000-entry directory listing truncates in `30 Sanasto/Sanat` alone.
- **A second writer is entering a repo with an active writer.** `obsidian-git` commits and
  pushes on its own schedule; API writes must coexist without either side's push being rejected.
- **ADR-024 already rejected this.** Its alternatives table dismisses "Obsidian-vault-in-Git /
  third-party sync services" with "nothing to integrate server-side". That was true of the
  paid-sync variant; a vault _in a GitHub repo we already read through the Contents API_ is
  exactly the store ADR-024 chose, with a schema the user now maintains by hand. The decision
  below revisits the layout, not the store.
- Unchanged rails: token custody (§5.2), one module owns repo access (§4.1), privacy — learning
  content only, never journal/mood/appreciation (§5.3), cost (NFR-8), and the product-owner
  rules from the 2026-07-17 walkthrough: acknowledge is the only streak source, Anki is the only
  SRS, the learning day is UTC, an untouched item carries over.

## Decision

We will make **the Obsidian vault's own schema the learning content model**. `LearningModule`
reads typed notes from the vault and writes progress back into the fields the vault already
defines. Nothing app-specific is added to the vault that Obsidian cannot read; nothing in the
vault is required to exist for the app's sake beyond one generated index folder.

### Content = the vault's typed notes

Each learning kind maps to one `type` and one folder; the API never scans the whole tree:

| Kind (ADR)                            | `type`          | Folder                                    | Eligibility                                                                                                                                                                               |
| ------------------------------------- | --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `japanese-wotd` (ADR-011)             | `vocab`, `verb` | `30 Sanasto/Sanat`, `20 Verbit/Lekseemit` | `status: new`, `jlpt` within the widget's `jlptCeiling`                                                                                                                                   |
| `japanese-grammar` (ADR-012)          | `grammar`       | `10 Kielioppi/Pisteet`                    | `status: new` (then review rotation, ADR-012's policy)                                                                                                                                    |
| `japanese-kanji` (new, later ADR)     | `kanji`         | `40 Kanji/Merkit`                         | as WOTD                                                                                                                                                                                   |
| `tech`, `system-design` (ADR-013/019) | —               | not in the vault yet                      | when authored, a sibling top-level area (`Tech/`) using the same conventions; until then ADR-013/019's `pool/tech/`, `pool/system-design/` files live under that area, unchanged in shape |

Note identity is the **vault-relative path** (e.g. `Japanese/30 Sanasto/Sanat/～目 (jarjestysluku).md`).
It is stable as long as the user does not rename the note, which is the vault's own identity
rule (wikilinks break on rename too), so the app inherits it rather than inventing an id.
`itemId` in every ADR-024 contract is this path.

Fields are consumed **as the vault names them** (Finnish-neutral keys: `word`, `reading`,
`meaning`, `jlpt`, `status`, …). No renaming layer. A note missing a required field (per
`check_vault.py`'s `REQUIRED` table) is skipped and reported — ADR-024's malformed-file rule.

Example sentences are **block embeds** — `![[Lausepankki — Silloin kun#^toki5]]` in the note
body, resolved against `50 Lauseet/Lausepankki — Silloin kun.md`'s line tagged `^toki5`. The
API resolves them at index time (below); the widget receives plain JA/FI text. Coverage is low
today (24 of 7 959 vocab notes embed one); the widget renders "no example yet" and never
blocks on it.

Furigana: the vault stores `reading` as kana, not ADR-024's bracket notation. For a single
headword the widget renders `<ruby lang="ja">word<rt>reading</rt></ruby>` directly; no
alignment is needed. Sentences remain plain, as ADR-011 already accepted. Bracket furigana
stays the convention only where a note author writes it (the `furigana` plugin is installed).

Meaning language: the vault is FI-first (`meaning` is Finnish; the body's `## Merkitys` carries
`**FI:**` and `**EN:**` lines). The WOTD and grammar widgets gain a setting
`meaningLanguage: "fi" | "en"` (default `fi`); `en` falls back to `fi` when the body has no EN
line. Widget chrome stays English.

### Progress = `status`, `confidence`, `reviewed` — written to the note

ADR-024's `progress/<kind>.json` is **not created**. The API's per-user state is the note's
front-matter, so what the app records is what Obsidian's `Kertaus` views show:

| Action (ADR-011/012)       | Front-matter write                                                              | Event                                        |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| acknowledge ("learned it") | `status: new → learning`, `reviewed: <UTC date>`, `confidence: max(2, current)` | `wotd.acknowledged` — the only streak source |
| skip ("already knew it")   | `status: known`, `reviewed: <UTC date>`                                         | none                                         |
| grammar "mark studied"     | as acknowledge                                                                  | `grammar.studied`                            |
| grammar "next point"       | `reviewed: <UTC date>` only                                                     | none                                         |

A `confidence` already above the floor is never lowered by the app; `shaky`/`known` set by hand
in Obsidian are respected (a `known` word is never served). Un-doing anything is editing the
note in Obsidian — the hand-editability ADR-024 promised, now in the tool the user actually
uses. The app never touches the body.

**Day pin.** The one piece of state the vault has no field for is "which item is today's".
It lives in a single small file the app owns, `.cc/state.json`: `{ "<kind>": { date, itemId,
resolved } }` — one line per kind, sha-guarded like every write, hand-editable, and ignored by
Obsidian (dot-folder). Selection stays ADR-011/012's: eligible set computed from the index,
date-seeded pick (WOTD) or lowest-order unseen (grammar), pinned on the first serve of a UTC day
whose previous item is resolved, carry-over otherwise. "Seen" is no longer a separate set: an
item with `reviewed` set or `status ≠ new` is not eligible, so no-repeat-until-exhaustion holds
by construction and a cycle "reset" is the user bulk-editing `status` in a Bases table.

Grammar ordering: the vault has no `sequence`. Order = `jlpt` ascending, then the first
`sources` link's chapter (`[[Minna no Nihongo Chuukyuu II#Luku 20]]` — book, then chapter
number), then `created`. Notes with no `sources` (106 of 317 today) sort last within their
level. This is the textbook's teaching order, which is what ADR-012's curated `sequence` was
approximating.

### Cards = `## Kortit`; "Add to Anki" = the vault's own export

ADR-024's `cards/**` tree, `anki: true` flag, `jp-<ent_seq>` ids, and ADR-026's `CC Japanese
v1` / `CC Tech v1` note types and `cc:<id>` guids are **not created**. The card population is
the `## Kortit` sections; the exporter is `sr_to_anki.py`'s parser (UID = sha1 of
`<relative path>|<front>`, note type `Japani (Obsidian)`, fields `UID`, `Front`, `Back`,
`Source`, tags from `#flashcards/...` and `jlpt`).

ADR-026's sync Action keeps its shape (thin caller workflow in the vault, machinery in
`tools/anki-sync`, sync-down → upsert → sync-up, never full-upload, `sync/state.json` written by
the Action) with three substitutions: the card source is the `sr_to_anki.py` parse of the whole
vault instead of `cards/**`; the note key is the vault UID (guid = the UID, `UID` field
searchable) instead of `cc:<id>`; the push trigger is path-filtered to the content folders
(`Japanese/**/*.md`, excluding `.cc/**` and `sync/**`) instead of `cards/**`. Import mode (existing
decks → repo) is **dropped**: the vault _is_ the existing deck's source now, and the prior
Anki-only deck is a one-time manual TSV import the user has already done by hand once.

The widget's **"Add to Anki"** action therefore changes meaning. Every vault note already has a
card, so for vault content the action is redundant with the sync and is **removed from the WOTD
and grammar widgets**; the footer's sync status (ADR-026's three honest states) stays. The
shared `POST /cards/:kind` contract survives only for kinds whose content has no note yet
(ADR-013/019's tech and system-design lessons, until they move into a vault area). ADR-019's
optional personal `notes` field is **dropped for vault kinds**: appending it to the note's
`## Sekoitan tähän` section would break the rule that the app never touches the body, and a
personal remark belongs in Obsidian, where the note is already open.

### Read path: a vault-side index, not a tree walk

ADR-024's cache design (in-memory, ETag-refreshed, SHA-pinned, serve-stale-forever, ~6 h TTL,
cold-boot "try again later") stands **unchanged**, reading a small fixed set of files. What
changes is who produces them:

- A **GitHub Actions workflow in the vault** (`.github/workflows/cc-index.yml`, path-filtered
  to `Japanese/**/*.md`, concurrency-grouped, `contents: write`) runs an indexer that reuses
  `check_vault.py`'s front-matter parser and emits `.cc/index/{vocab,verb,kanji,grammar}.jsonl`
  (one line per note: path, the fields in the table above, resolved example sentences, the
  `## Merkitys` EN line) plus `.cc/index/manifest.json` (`schemaVersion`, generated-at SHA,
  counts, `check_vault` error list). The indexer is a **Python script in the vault**
  (`00 Meta/Scripts/cc_index.py`, next to the two scripts it extends) so the user can run it
  locally with the vault's existing tooling; the workflow is the thin caller. Same
  vault-runs-machinery posture as ADR-026, without a cross-repo action: the parser is the
  vault's, so it lives with the vault.
- The API reads `manifest.json` + the JSONL shards at one SHA. Shards are split at ~500 lines
  when over the 1 MB comfort zone (vocab will be ~16 files), following ADR-024's own sharding
  rule. The index is **derived data** — regenerated wholesale, never hand-edited, and a
  push of the index never re-triggers the indexer (`.cc/**` excluded from the path filter).
- Writes (front-matter edits, `.cc/state.json`) are per-file Contents-API `PUT`s with the sha
  guard ADR-024 specifies: a few lines each, well under any size concern, retried on 409 by
  refetch-reapply. A front-matter write is a **text edit of the YAML block only** — the API
  parses the block, updates the three known keys in place, and writes the file back with the
  body byte-identical, so an Obsidian-side diff shows exactly one to three changed lines.
- Index freshness: the API sees an acknowledge it just wrote before the index catches up. Reads
  therefore **overlay `.cc/state.json` and the API's own last-written statuses** (in-memory, keyed
  by path, cleared on the next index refresh that reflects them) on top of the index, so a
  just-acknowledged word cannot be served again in the minutes before the indexer runs.

### Coexistence with `obsidian-git`

The vault already has an automatic committer. Runbook rules, not code:

- API commits go to `main` with a distinct author (`command-center[bot]`) and a fixed message
  prefix (`cc: <kind> <action> <path>`), so `git log` separates app writes from backups.
- `obsidian-git` must be configured to **pull before push** (its "pull before push" / auto-pull
  setting) — otherwise a backup push after an API commit is rejected. Conflicts are structurally
  unlikely (the app edits three front-matter lines; a same-minute hand edit of the same note is
  the only overlap) and resolve in Obsidian like any other.
- The API never force-pushes, never touches branches, never writes outside the note it is
  acting on, `.cc/`, and (via the Action) `sync/`.

### API contract deltas

ADR-024's endpoints stand with these changes:

- `itemId` is the vault-relative path everywhere.
- `GET /wotd` and ADR-012's `GET /grammar/today` gain `meaning: { fi, en? }` and drop
  `attribution` (no third-party data; ADR-032's about-panel row becomes a one-line "content:
  your learning-center vault" credit). `saved`/`cardPath` are dropped for vault kinds — the card
  always exists.
- `POST /wotd/acknowledge`, `/wotd/skip`, `/grammar/advance`, `/grammar/:id/studied` behave as
  before; their side effect is the front-matter write above plus the `.cc/state.json` pin.
- `POST /cards/:kind` remains for non-vault kinds only; `404` for vault kinds.
- `GET /anki-status` unchanged in shape; `decks` reflects the `Japani` deck.
- A new read, `GET /learning/vault-status` → `{ indexedAt, indexSha, counts, errors[] }`, so
  the widget's about panel can say "index 2 h old · 3 notes skipped" and link to the Action run.
  No write endpoints beyond the above; the vault stays the user's to shape.

## Consequences

- **Easier:** no ingest tool, no seeded pool, no licence manifest, no second progress model, no
  second card tree, no import mode — four of ADR-024/026's moving parts and two of the three
  planned `tools/` packages are deleted before being built. The user's daily Obsidian practice
  and the dashboard tiles share one truth: acknowledging a word on the dashboard is what fills
  the vault's own "weakest first" and "not reviewed in 30 days" views.
- **Easier:** new tiles are cheap because the vault already has the data — recurring mistakes
  (`type: mistake`, `recurring: true`, `fixed: false`), a kanji of the day, a study-log
  streak from `90 Paivakirja/Loki` (`minutes` per day — a candidate additional streak source
  for ADR-014, to be decided in its own amendment, not here).
- **Harder / accepted:** the API depends on the vault's conventions (folder names, `type`
  values, field names, `^block-id` embeds). A vault refactor that renames a folder or a field
  breaks the index until `cc_index.py` follows. Mitigation: the indexer is in the vault, next
  to `check_vault.py`, so a schema change and its indexer change are one commit; the manifest's
  `schemaVersion` lets the API refuse an index it does not understand with an explicit
  "vault schema changed" state instead of serving garbage.
- **Harder / accepted:** note identity is the path; a rename in Obsidian orphans the day pin
  and the Anki UID for that note (one card re-created, its review history lost — the same
  cost the vault already documents for editing a card's front). The runbook says so.
- **Harder / accepted:** index latency. An acknowledge is visible in Obsidian immediately and in
  the API's own overlay immediately, but in the index only after the Action runs (a minute or
  two). Accepted at single-user scale; the overlay closes the one user-visible race.
- **Concurrency:** two writers on one branch. Bounded by the pull-before-push rule and the
  three-line write footprint; the failure mode is a rejected backup push the user resolves
  in Obsidian, never data loss on either side.
- **JLPT skew:** 4 783 of 9 419 words carry `jlpt: N2` from the bulk import. With a ceiling
  at N3 the eligible set is ~6 000 words and fine; with the ceiling at N2 the pick is
  N2-heavy. Not a design problem — a curation note for the vault (and a reason the ordering
  falls back to `sources` chapter, which is level-correct by construction).
- **Vault hygiene the app now depends on:** `60 Lahteet/.mnn-rebuild/**` and `.kic-rebuild/**`
  (893 tracked PDF-extraction intermediates of copyrighted textbooks, ~480 MB on disk) and
  `.obsidian/workspace.json`/`.DS_Store` should leave the repo and its history before the
  first Action runs there — they are not read by anything here, but a 107 MB `.git` makes
  every Actions checkout slow, and the content should not sit in a repo a CI token can reach.
  Recorded in the runbook as a setup step.
- **Docs owed on acceptance:** ADR-024 — mark the four layout sections superseded, and revise
  the "Obsidian-vault-in-Git" alternative to say why it now wins; ADR-011 — `itemId`, settings
  (`meaningLanguage`; `showRomaji` reads `romaji`), no "Add to Anki", no attribution; ADR-012
  — folder, ordering rule, block-embed examples, no `sequence`; ADR-013/019 — `pool/tech/`
  and `pool/system-design/` re-homed under a `Tech/` vault area (shape unchanged), `notes`
  dropped for vault kinds; ADR-026 — card source, guid, note type, trigger filter, import mode
  dropped; ADR-032 — R5 closed by ownership for Japanese, attribution row withdrawn;
  `docs/runbook-learning-center.md` — steps 6–8 replaced by index workflow + `obsidian-git`
  settings + hygiene; `docs/ADR.md` §3 diagram, §4.3/§4.5 prose, §7 rows 011/012/024/026/032.

## Alternatives considered

- **Keep ADR-024's layout and import the vault into it** (an ingest tool that reads the vault
  and emits `pool/` shards + `cards/**`): rejected — it makes the vault an upstream of a copy
  the user never looks at, reintroduces two progress models and two card trees, and every
  acknowledge would have to be mirrored back into the vault anyway to keep Obsidian's views
  honest. The vault's schema is already machine-readable; copying it adds a sync problem.
- **Progress in `progress/<kind>.json` as accepted, with a mirror into `status`/`reviewed`:**
  rejected — two writes per action to two representations of the same fact, and the JSON copy
  is the one nobody reads. If a future need appears for state the vault has no field for, the
  precedent is `.cc/state.json`: app-owned, dot-folder, minimal.
- **Per-file reads through the Contents API with a recursive Git Trees listing** (no index):
  rejected — the tree call works at 14 000 entries, but a refresh would then fetch thousands
  of blobs; even at 6 h TTL that is the bulk of the rate budget spent on data the API needs one
  field-set from. The index is also what makes `check_vault.py`'s validation the API's
  validation for free.
- **Tarball download at a SHA per refresh** (`GET /repos/…/tarball/<sha>`): workable — one
  request, parse in memory — but the repo currently weighs ~480 MB of untracked-by-intent
  intermediates and 598 MB of PDFs on disk (PDFs are gitignored; the intermediates are not),
  and a refresh should not depend on the user's hygiene. Kept as the fallback if the Action
  ever becomes a burden.
- **Indexer as a `tools/` composite action in the monorepo** (ADR-026's distribution pattern):
  rejected for the indexer specifically — the parser it needs is the vault's own Python, and
  the schema it encodes is the vault's; splitting them across repos means every vault refactor
  is two commits in two repos. ADR-026's sync action keeps that pattern because its machinery
  (the `anki` library, the never-full-upload rule) is app policy, not vault schema.
- **Writing progress into a note's body** (a `## Historia` section, or ticking a card): rejected
  — the body is the user's prose; front-matter is the vault's declared machine interface, and
  three-line YAML diffs are reviewable in `git log -p` where body edits are not.
- **Keeping "Add to Anki" as a per-note `anki: true` opt-in** for vault kinds: rejected for v1
  — 10 858 notes already carry cards, and the vault's stated workflow is "cards go to Anki";
  an opt-in flag defaults nearly every card out or in, neither of which is a decision the
  widget should be making. Selective export, if wanted, is a vault-side rule (a tag), not a
  dashboard button.
- **Using the Obsidian Spaced-Repetition plugin as the SRS instead of Anki:** out of scope —
  ADR-025's rejection and ADR-012's "Anki _is_ the SRS" stand; the SR syntax is used as a
  card _format_ only, which is exactly how the vault's own guide describes it.
- **A mobile/desktop sync service other than git (Obsidian Sync, iCloud):** unchanged from
  ADR-024 — nothing server-side to integrate, and paid sync violates NFR-8. The vault is in git
  already, which is what makes this ADR possible.
