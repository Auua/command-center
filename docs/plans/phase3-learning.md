# Phase 3 plan — Learning (vault-backed)

_Written 2026-09-18 against ADR-040 (accepted 2026-09-18) and the first `.cc/index` in the
learning-center vault. Supersedes the July 2026 v1 plan, which targeted ADR-024's unbuilt layout._

## Scope and order

Phase 3 per `docs/ADR.md` §9: Japanese WOTD and grammar, streaks, Anki sync, tech "X of the day".
Two scope facts change the order from the July plan:

- **Tech lessons have no content.** ADR-040 puts them in a `Tech/` vault area "when authored";
  nothing is authored. The tech widget (ADR-013) and system-design widget (ADR-019) are **out of
  Phase 3** until a first lesson set exists in the vault. Their contracts stay reserved.
- **Kanji needs its own ADR** (ADR-040's table: "japanese-kanji (new, later ADR)"). The index
  already carries the kanji shard, so the widget is a stretch step once the ADR is written.

Delivery is five PRs, each leaving `main` deployable and dogfood-able:

| Step | PR                       | Ships                                                                                                      | Depends on  |
| ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------- |
| 3A ✓ | `phase3-sdk` (PR #27)    | Settings panel, per-instance widget ids, size validation. Closes the SDK gaps every learning ADR leans on. | —           |
| 3B ✓ | `phase3-learning-core`   | `LearningModule`: vault client, index cache, day pins, front-matter writes, WOTD endpoints + widget.       | 3A          |
| 3C ✓ | `phase3-grammar-streaks` | Grammar endpoints + widget; `StreaksService` + `streaks` widget; `wotd.acknowledged`/`grammar.studied`.    | 3B          |
| 3D ✓ | `phase3-anki-sync`       | `tools/anki-sync` composite action, `anki-sync.yml` caller in the vault, `GET /anki-status`, footers.      | 3B          |
| 3E   | `phase3-kanji` (stretch) | ADR-041 kanji widget, then the widget on the existing index shard.                                         | 3C, ADR-041 |

3C and 3D are independent of each other and can land in either order.

## 3A — Widget SDK gaps

**Per-instance widgets (ADR-013, review 2026-09-17).** `widget_layouts` gains
`instance_key text not null default ''` and the unique constraint becomes
`(user_id, widget_id, instance_key)` (migration `0009_widget_layouts_instance_key.sql`).
`WidgetLayoutItemSchema` gains `instanceKey: z.string().default('')`. `widgetId` stays the
registry lookup key, so nothing in the shell changes for single-instance widgets; the
`LayoutService` uniqueness check keys on the pair. The grid's React key becomes
`widgetId:instanceKey`. Chosen over encoding the instance into `widgetId` because the registry
lookup and every existing row stay untouched.

**Settings panel (ADR §4.2).** `WidgetCard` gains a gear button (`aria-label` "Settings for
<title>") that opens a native `<dialog>` (the reminders builder's pattern) rendering a form
generated from the widget's zod `settingsSchema`: boolean → checkbox, `z.enum` → `<select>`,
number → `<input type=number>`, string → `<input>`, arrays of enum → checkbox group. Field
labels come from the i18n catalog keyed `settings.<widgetId>.<field>`, falling back to the field
name. Save validates with the schema, replaces the item's `settings` in the layout, `PUT /layout`,
and invalidates the `['layout']` query. No layout editing (add/remove/reorder) — that remains
Phase 4 polish; a widget's settings are the only thing the panel edits.

The zod introspection lives in `packages/ui` (`settings-form.tsx`) so a widget author adds a
schema and gets the panel — no bespoke UI, as ADR-011/012/014 assume.

**Size validation.** The grid clamps a layout item's `gridPos` to the nearest declared size
(largest declared size that fits) instead of rendering an undeclared one.

Versions: contracts, ui, web, api minor bumps; root bump.

## 3B — LearningModule core + WOTD

### Env and configuration

`GITHUB_LEARNING_REPO` (`owner/name`) and `GITHUB_LEARNING_TOKEN` (fine-grained PAT, Contents
read/write on that one repo), optional as a pair using the ADR-039 env-group pattern
(`isLearningConfigured`). Unset → every learning read answers `{ configured: false }`; the
widgets render their not-configured state with a runbook pointer. `docs/ENV_SETUP.md` gains the
pair and the PAT generation steps; `docs/runbook-learning-center.md` step 4 already describes the
token.

### Vault client (`learning/vault/`)

Plain `fetch` against the GitHub REST API, four calls: `GET /repos/:r/branches/main` (head sha),
`GET /repos/:r/contents/:path?ref=` (file with sha), `PUT /repos/:r/contents/:path` (create/update
with `sha` guard, author `command-center[bot]`, message `cc: <kind> <action> <path>`), and the
raw-content variant for the index shards. A 401/403 flips a module-wide `tokenInvalid` flag that
reads surface as `{ configured: true, state: 'token-invalid' }` (ADR-024) and that clears on the
next successful call. 409 on PUT → refetch sha, reapply, retry once.

### Index cache (`learning/index/`)

In-memory, per process. Refresh: resolve head sha → fetch `.cc/index/manifest.json` at that sha
→ fetch every shard listed in `manifest.shards` at the same sha → replace the cache atomically
`{ sha, generatedAt, records: Map<path, IndexRecord>, byKind, errors }`. TTL 6 h, refreshed on
first read after expiry with the request served from the old cache (stale-while-revalidate);
refresh failures keep the old cache forever. No cache at all → `state: 'unavailable'`.

Record schema = the indexer's output (`IndexRecordSchema` in contracts, kind-discriminated on
`type`), validated on load; an invalid line is skipped and counted.

**Overlay.** `LearningStateService` keeps `.cc/state.json` (day pins) and an in-memory
`recentWrites: Map<path, { status, reviewed, confidence, sha }>` on top of the index. A refresh
that reflects a recent write (record's `status`/`reviewed` match) drops it from the overlay. Eligible
sets are computed over index ∪ overlay.

### Front-matter writer (`learning/vault/front-matter.ts`)

Pure function `applyProgress(text, { status?, confidence?, reviewed? }) → text`: locates the
YAML block, rewrites only the three known keys in place (preserving their order and quoting
style), appends a missing key after `status`, and returns the body byte-identical. Unit-tested
against the three note shapes in the vault (inline lists, multi-line lists, empty `reviewed:`).
`confidence` is `max(2, current)`, never lowered. `reviewed` is the home-timezone date from
`ProfileService.getTimezone` (the `AutomationModule` seam).

### Day pins (`.cc/state.json`)

`{ schemaVersion: 1, kinds: { wotd: { date, itemId, resolved }, grammar: {…} } }`, sha-guarded
like every write. Selection per ADR-011: eligible = index records of type `vocab`|`verb` with
`status: new`, `reviewed` null, `jlpt` within the widget's `jlptCeiling` (request query, like
grammar's ceiling — the client owns delivering its settings). Pick = date-seeded hash
(`sha256(utcDate + kind)` mod eligible.length over the path-sorted list). A new pin only on the
first serve of a UTC day whose previous pin is resolved; otherwise carry-over.

### Endpoints (`/api/v1/learning`, JWT)

- `GET /wotd?ceiling=N5` → `{ configured: false }` | `{ configured: true, state: 'ok' |
'unavailable' | 'token-invalid', date, item?: WotdItem, acknowledged, streak? }` where
  `WotdItem = { itemId, kind: 'vocab'|'verb', word, reading, romaji, meaning: { fi, en? }, jlpt,
pos?/verbclass?, examples: [{ ja, fi }], sourceUrl }`.
- `POST /wotd/acknowledge { itemId }` → same shape, `acknowledged: true`; writes front-matter
  (`learning`, `confidence ≥ 2`, `reviewed`), marks the pin resolved, emits `wotd.acknowledged`.
  409 on a stale `itemId`.
- `POST /wotd/skip { itemId }` → same shape with the replacement item; writes `known` +
  `reviewed`, re-pins. No event.
- `GET /vault-status` → `{ configured, state, indexedAt, indexSha, counts, skipped, errors[],
workflowUrl }`.
- Learning-side failures (`unavailable` after a successful boot, `token-invalid`, index older than
  48 h) insert one open `notifications` row with `source: 'learning'` per condition
  (`NotificationRepository` gains `upsertOpenBySourceKey`).

Contracts: `packages/contracts/src/schemas/learning.ts` (+ tests); events: `WOTD_ACKNOWLEDGED_EVENT`
in `events.ts`.

### WOTD widget (`apps/web/widgets/japanese-wotd/`)

Settings `{ jlptCeiling: enum N5–N1 = 'N5', showFurigana = true, showRomaji = false,
meaningLanguage: 'fi'|'en' = 'fi' }`. Quick actions: acknowledge, skip. Card: `<ruby lang="ja">`
headword with kana `<rt>`, meaning in the chosen language with Finnish fallback, first example
plain JA + FI, JLPT chip, footer sync status placeholder until 3D. States per ADR-011 as amended
(not-configured, unavailable with retry, token-invalid, acknowledged, no example yet). Copy in the
catalog. About panel: "content: your learning-center vault" + vault-status line.

### Tests

Unit: selection (determinism, carry-over, eligibility with overlay), front-matter writer
(byte-identical body, key ordering, quoting), index loader (skips bad lines), vault client (sha
retry, token-invalid flip) with a fetch stub. e2e: `/learning/wotd` against a stubbed GitHub
(fetch mock returning a fixture index of ~20 notes). Web: widget states with vitest.

## 3C — Grammar + streaks

**Grammar (ADR-012 as amended).** Same module. Eligible = `grammar` records with `status: new`
and `jlpt ≤ ceiling`; order = `jlpt` asc → `source.book` → `source.chapter` → `created` → path.
Review mode when exhausted: oldest `reviewed`. Endpoints `GET /grammar/today?ceiling`,
`POST /grammar/advance`, `POST /grammar/:id/studied` (front-matter as acknowledge; emits
`grammar.studied`). Widget `japanese-grammar` with settings `{ jlptCeiling, showFurigana,
showRomaji, revealTranslation, meaningLanguage }`; renders `ja` pattern, meaning, up to two
examples, "N4 · 12/80 seen" from index counts.

**Streaks (ADR-014).** Migration `0010_streaks.sql`: `streaks (user_id, widget_id, current_len,
best_len, last_active_date, updated_at, unique(user_id, widget_id))` + `streak_days`. RLS on
both. `StreaksService` inside `LearningModule` with the declarative `EVENT_TO_STREAK` map
(`task.completed`, `wotd.acknowledged`, `grammar.studied`; mood/journal when those emit).
Local date = home timezone with the 03:00 grace rule. **Rollover is computed on read**, not by a
job: `GET /streaks` derives `currentLen` as 0 when `last_active_date` is older than yesterday in
home time. This replaces ADR-014's pg-boss rollover, which ADR-039 deferred; a header note on
ADR-014 records it. Widget `streaks` per ADR-014 (read-only rows, 7-day dots, quiet milestones).
WOTD and grammar cards show the streak pill from the same hook.

## 3D — Anki sync

`tools/anki-sync/` composite action in this repo (Python, pinned `anki` wheel): parse every
`## Kortit` card with the vault's `sr_to_anki.py` rules (import it from the checkout), sync-down
from AnkiWeb, upsert notes keyed on the vault UID into deck `Japani` / note type
`Japani (Obsidian)`, sync-up, write `sync/state.json` `{ lastSyncAt, lastRunStatus, lastRunUrl,
counts, errors[] }`. Caller workflow `anki-sync.yml` in the vault per runbook step 7; release tag
`anki-sync-v1` per step 8. API: `GET /anki-status` reads `sync/state.json` (60 s cache) and counts
note commits since `lastSyncAt`. Footers on WOTD and grammar render the three honest states.
Vault secrets `ANKIWEB_EMAIL`/`ANKIWEB_PASSWORD` are the product owner's step.

## 3E — Kanji (stretch)

ADR-041 first (selection = WOTD's over the kanji shard; card = character, meaning, readings table,
example words from the `Sanat joissa esiintyy` base are not in the index — decide whether to add a
`words[]` field to the indexer). Then `japanese-kanji` widget. Not started before 3C is on main.

## Docs owed per step

- 3A: ADR.md §4.2 (settings panel, instance keys), §4.4 ERD (`instance_key`), CLAUDE.md Current
  State, README widget-system paragraph.
- 3B: ENV_SETUP (pair), runbook step 4 check, ADR.md §4.4 (no new tables; `.cc/state.json`
  described under §4.3), CLAUDE.md, README.
- 3C: ADR.md §4.4 ERD (`streaks`, `streak_days`), ADR-014 header note (read-time rollover).
- 3D: runbook steps 7–9 verified against the real action, PHASE3_SETUP.md (PAT, vault secrets,
  tag) in the PHASE2_SETUP style.

## Out of scope, recorded

Tech / system-design widgets (no content), "Add to Anki" for vault kinds (removed by ADR-040),
layout add/remove/reorder UI (Phase 4), review widget (ADR-025 rejected), an app-owned progress
store (ADR-040).
