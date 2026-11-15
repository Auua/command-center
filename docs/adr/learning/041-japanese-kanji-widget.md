# ADR-041: Japanese Kanji-of-the-Day widget

- **Status:** accepted (2026-11-14)
- **Date:** 2026-11-14 (accepted the same day at the product-owner walkthrough — every decision as
  drafted; built as Phase 3E in the acceptance PR)
- **Review:** claude-reviewed, PO-reviewed — accepted 2026-11-14
- **Depends on:** ADR-040 (vault as the learning store), ADR-011 (WOTD selection and pacing),
  ADR-014 (streaks). Amends ADR-014's learning-source list and ADR-040's kind table on acceptance.

## Context

ADR-040's kind table reserves a `japanese-kanji` kind ("new, later ADR") over the vault's
`type: kanji` notes in `Japanese/40 Kanji/Merkit`, with eligibility "as WOTD". The Phase 3 plan
(`docs/plans/phase3-learning.md`, step 3E) makes the widget a stretch step gated on this ADR, and
asks one open question: the kanji note's "Sanat joissa esiintyy" (words this kanji appears in)
section is an Obsidian Bases view, not front-matter, so the words are **not in the index** — decide
whether the indexer grows a `words[]` field.

What the vault holds today (index generated 2026-10-23, `schemaVersion: 1`):

| Fact                                                | Value                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Kanji notes in the shard                            | 1 109 (2 skipped: kun-only kanji with no `onyomi`, which `check_vault.py` requires)                      |
| `status`                                            | 1 053 `new`, 30 `known`, 20 `shaky`, 6 `learning` — all hand-set; `reviewed` on none                     |
| `jlpt`                                              | N5 289 · N4 274 · N3 233 · N2 282 · N1 31                                                                |
| Front-matter in the index                           | `kanji`, `strokes`, `grade`, `onyomi[]`, `kunyomi[]`, `meaning.fi`, `components[]`, `lookalikes[]`       |
| `meaning.en`                                        | 0 of 1 109 — kanji notes have no `## Merkitys` EN line                                                   |
| `components` / `lookalikes` set                     | 441 / 93 notes, as `[[人]]`-style wikilinks                                                              |
| `grade`                                             | `1`–`6` on 407 notes; a prose string (`N/A (jouyou, ei perusasteen kanji)`) on 118; empty on 582         |
| Body sections (not indexed)                         | `## Muistisääntö` (mnemonic), `## Lukutavat` (readings table with example words), `## Osat`, `## Kortit` |
| Vocab/verb notes linking a kanji via `kanji: [[…]]` | 4 225 of 18 883 words; 1 081 of 1 109 kanji have ≥ 1 linked word, 919 have ≥ 3 (median 6)                |

The kanji note's `## Sanat joissa esiintyy` block is a Bases query — `kanji.contains(this.file.name)`
over the word notes — so the relation already exists in the index, on the **word side**: every
`vocab`/`verb` record carries its `kanji` list. The kanji shard needs no new field for the API to
answer "which words use this character".

Forces:

- **Same rails as WOTD.** ADR-040 fixed the content model, the progress model
  (`status`/`confidence`/`reviewed` written to the note, day pin in `.cc/state.json`), the UTC
  learning day with carry-over, the overlay for just-written progress, the bell for learning-side
  failures, and the product-owner rules (acknowledge is the only streak source; skip retires; Anki
  is the only SRS; no "Add to Anki" for vault kinds). This ADR adds a kind, not a mechanism.
- **A kanji is not a word.** The card's content differs: character, stroke count, on/kun readings
  with okurigana, components, look-alikes, and the words that anchor it. The vault's own card
  (`## Kortit`) drills meaning, readings, example words and look-alikes — the dashboard tile should
  show the same facets, so acknowledging on the dashboard and reviewing in Anki reinforce one view.
- **The best content is in the body.** The mnemonic (`## Muistisääntö`) is the one thing the
  user wrote by hand for every kanji and the thing most worth showing; the readings table pairs each
  reading with an example word. ADR-040's indexer already extracts one body fragment (the
  `## Merkitys` EN line), so body extraction has a precedent — but every new field is a vault-side
  change (`cc_index.py` lives in the vault, ADR-040), landed by the product owner, not by this repo.
- **Streak sources are enumerated.** ADR-014 fixes the learning sources to exactly
  `wotd.acknowledged`, `grammar.studied`, `lesson.completed`; a kanji streak needs an amendment.
- **Widget SDK (§4.2, Phase 3A):** settings are a zod schema rendered by the auto-generated panel
  (boolean / enum / number / string fields); quick actions are manifest-declared; sizes declared.

## Decision

We will build a `japanese-kanji` widget on `LearningModule`'s existing WOTD rails: the same
selection, pacing, progress write, overlay, pin, alert and event mechanics, parameterised for the
kanji shard. Example words come from the index's word side at read time; the mnemonic is an
**optional, additive** index field the widget renders when present.

### Selection and pacing (ADR-011/040, unchanged)

- **Eligible** = `type: kanji` records with `status: new`, `reviewed` unset, a non-empty `kanji`
  character, and `jlpt` at or below the widget's `jlptCeiling` (sent per request as `?ceiling=`,
  like WOTD). Hand-set `learning`/`shaky`/`known` kanji are never served. The API's progress
  overlay applies before eligibility, as for WOTD.
- **Pick** = date-seeded hash over the path-sorted eligible list, seeded `${utcDate}|kanji` — a
  different seed from WOTD's so the two tiles do not step in lockstep. **Pin** in `.cc/state.json`
  under kind `kanji`, made on the first serve of a UTC day whose previous pin is resolved;
  carry-over otherwise; a refresh never changes today's kanji; a pin whose note was renamed or
  hand-resolved in Obsidian counts as resolved. Exhaustion under the ceiling renders the "raise
  the ceiling" empty state, as WOTD does.
- **Acknowledge ("learned it")** → `status: new → learning`, `confidence: max(2, current)`,
  `reviewed: <home-timezone date>`; pin resolved; emits `kanji.acknowledged { userId, itemId, date,
acknowledgedAt }` — **the only kanji streak source**. **Skip ("already knew it")** → `status:
known`, `reviewed` stamped, replacement pinned immediately, no event. Both go through the shared
  `ProgressService` note write path and carry the `409` guard when `itemId` is not the current pin.

### Example words = the index's word side, at read time

`words[]` is **not added to the kanji shard**. The API derives the list from the loaded index:
every `vocab`/`verb` record whose `kanji` list contains `[[<character>]]` — exactly the vault's
own `kanji.contains(this.file.name)` rule, so the tile shows what the note's "Sanat joissa
esiintyy" view shows. Ordering: words with progress first (`known`, `learning`, `shaky` — the
anchors the user already has), then `jlpt` ascending, then path; capped at **6** on the card. Each
word carries `itemId`, `word`, `reading`, `meaning`, `jlpt`, `status`. A kanji with no linked
word renders "no linked words yet" — a normal state and a curation nudge, never an error (the
28 such kanji today).

The lookup is a one-time inverted map built when the index loads (`character → word paths`),
not a scan per request.
→ _PO-review (2026-11-14):_ words from the word notes' `kanji` links confirmed — no `words[]`
field, no substring fallback.

### Mnemonic = optional index field

The kanji shard gains **one optional field, `mnemonic: string | null`** — the text of the note's
`## Muistisääntö` section (block-quote markers stripped, paragraphs joined with a blank line, no
wikilinks resolved). It is produced by `cc_index.py` in the vault (ADR-040: the indexer lives
with the schema it encodes), is additive, and leaves `schemaVersion` at 1 — the API's zod schema
reads it as `.optional().nullable()` and the widget renders the section only when the string is
non-empty. **The widget ships without waiting for it**: until the vault's indexer emits the field,
every card simply has no mnemonic section. The readings table's per-reading example words stay
in the body: the `kunyomi`/`onyomi` lists plus the linked words cover the same ground.
→ _PO-review (2026-11-14):_ optional additive `mnemonic` confirmed; the widget ships ahead of
the vault-side indexer change.

### Frontend

- `apps/web/widgets/japanese-kanji/` exporting a `WidgetDefinition` with `id: "japanese-kanji"`,
  sizes `{2×2, 3×2}` (WOTD's), `quickActions: [kanji-acknowledge, kanji-skip]`, and settings
  `{ jlptCeiling: N5|N4|N3|N2|N1 (default N5), showComponents: boolean (default true),
showExampleWords: boolean (default true) }`. No `meaningLanguage`: kanji notes carry no EN
  meaning (0 of 1 109), so the switch would do nothing; it is added the day the vault has EN lines.
  No `showFurigana`/`showRomaji`: readings are the content, not a supplement.
- **Card:** the character large (`lang="ja"`, the dominant element — the tile is a glyph tile);
  meaning (FI); a JLPT chip and, when numeric, a school-grade chip (`grade` normalised: `'1'`–`'6'`
  → number, anything else → null — the vault's prose `N/A (…)` value is not a chip); stroke count;
  **readings** as two labelled rows, on'yomi in katakana and kun'yomi in hiragana, each kun'yomi
  rendered with the okurigana after the vault's `.` separator in a muted style (`た.べる` →
  た<span class="okurigana">べる</span>); **components** and **look-alikes** as character chips
  (brackets stripped; no navigation in v1); the **mnemonic** when present; **words** as a compact
  list (word with ruby reading, FI meaning, JLPT chip; a progress dot for `known`/`learning`).
- Footer: acknowledge / skip buttons, the `japanese-kanji` streak pill from the shared
  `['streaks']` query, the Anki sync status (`components/anki-sync-status.tsx`), all as WOTD.
- Data via `lib/learning-api.ts` (`fetchKanji`, `acknowledgeKanji`, `skipKanji`), TanStack Query key
  `['learning', 'kanji', ceiling]`; optimistic nothing — the response is the new state, as WOTD.
- i18n: all chrome through the catalog (`kanji.*`), streak name `streaks.name.japanese-kanji`.
- **Accessibility:** `lang="ja"` on the character, every reading, every chip and every word; the
  okurigana split is presentational only (`aria-hidden` on nothing — the full reading stays one
  text node for screen readers); announcements mirror WOTD ("Marked learned — next kanji
  tomorrow" politely, failures as `role="alert"`); chips never colour-only; focus stays put on skip
  so the replacement is announced through the polite region.

### Backend

- `learning/kanji/selection.ts` — the WOTD pure functions generalised over the record type where
  the logic is identical (`withOverlay`, `decidePin`, `pickForDate` with a kind-specific seed) and
  a kanji `isEligible`; `linkedWords(index, character)` over the inverted map.
- `learning/kanji/kanji.service.ts` — `getToday`, `acknowledge`, `skip`, mirroring `WotdService`
  including staleness/token alerts and the degraded response. Shared pieces that the two services
  would otherwise duplicate (today's UTC date, `currentPin` with the 409 guard, the degraded
  response) move into a small shared helper in `learning/` rather than being copied a third time.
- `learning/index/index-cache.service.ts` — builds the `character → word paths` map at load.
- Routes on the existing controller, JWT-guarded, zod-validated:
  - `GET /learning/kanji?ceiling=` → `{ configured: false }` | `{ configured: true, state, date,
item: KanjiItem | null, acknowledged, exhausted, index }` (WOTD's envelope).
  - `POST /learning/kanji/acknowledge` `{ itemId }`, `POST /learning/kanji/skip?ceiling=`
    `{ itemId }` — same envelope back; `409` on a stale `itemId`.
- `KanjiItem` (in `packages/contracts`): `{ itemId, kanji, strokes, grade: number | null, jlpt,
onyomi[], kunyomi[], meaning: { fi, en }, components: string[], lookalikes: string[],
mnemonic: string | null, words: KanjiWord[], status, confidence, sourceUrl }`;
  `KanjiWord = { itemId, word, reading, meaning, jlpt, status }`.
- Events: `kanji.acknowledged` joins `packages/contracts/schemas/events.ts` with WOTD's payload
  shape; `StreaksService` maps it to the new key `japanese-kanji` (`STREAK_KEYS` grows by one;
  no migration — keys are data in `streaks`/`streak_days`). Emitters pass `{ user }` as the
  event context (Phase 3C convention) so the streak row is written under the request's JWT.
  → _PO-review (2026-11-14):_ separate `japanese-kanji` streak confirmed; no `meaningLanguage`
  setting confirmed; the two kun-only kanji stay a vault-side `onyomi: []` fix.

### Data model

No database surface beyond the one streak key. Progress is the kanji note's front-matter; the
pin is `.cc/state.json`'s `kanji` entry; the words relation is read from the existing
vocab/verb shards; the mnemonic is an additive index field. The app never touches a note body.

## Consequences

- **Easier:** the fourth vault kind costs no new storage, no indexer change for the words
  relation, and no new mechanism — selection, pacing, progress, alerts, streaks and the sync
  footer are reused; the tile fills the vault's `Kertaus` views for kanji the same way WOTD does
  for words. Acknowledging a kanji whose linked words are already `known` is cheap reinforcement
  in the direction the vault is organised (words → kanji).
- **Easier:** the words list is live — a word tagged with `kanji: [[食]]` in Obsidian shows under
  食 on the next index run, with no app change.
- **Harder / accepted:** the words relation depends on the vault's curation of the `kanji` field
  (4 225 of 18 883 words carry it). Coverage is already high per kanji (1 081 of 1 109) because
  the common kanji are the tagged ones; the 28 uncovered kanji show the empty state. A substring
  fallback is recorded under Alternatives and stays rejected.
- **Harder / accepted:** the mnemonic arrives only after the vault-side indexer change. Until
  then the card is readings + components + words; the widget must not look broken without it
  (the section is simply absent — no placeholder).
- **Harder / accepted:** the `kanji` character doubles as the inverted-map key, so a kanji note
  whose file name and `kanji` field disagree links nothing (the Bases view has the same
  property — it keys on `this.file.name`). `check_vault.py` is the place to assert they match.
- **Vault hygiene surfaced:** 2 kun-only kanji are skipped by the indexer because `onyomi` is
  required; the fix is `onyomi: []` in those notes, or relaxing `REQUIRED` — a vault decision,
  recorded here so the manifest's `skipped.kanji: 2` is understood.
- **Vault side closed (2026-11-15, vault PR #4):** `cc_index.py` emits `mnemonic` (527 of the
  2 288 kanji notes have one; the rest are `null`), as plain text with the note's line breaks
  kept — the card renders it `white-space: pre-line`. The skipped kanji turned out to be eight,
  all already carrying `onyomi: []`: the indexer treated the empty list as missing. It now
  accepts an empty `onyomi`, so `skipped.kanji` is 0 and kun-only kanji are eligible like any
  other.
- **Docs applied at acceptance (2026-11-14):** ADR-014 — header note adding `kanji.acknowledged`
  → `japanese-kanji` to the learning sources; ADR-040 — kind table row `japanese-kanji` points
  here, and the index record shape gains the optional `mnemonic`; `docs/ADR.md` §7 row 041;
  `docs/runbook-learning-center.md` — the `cc_index.py` change (`mnemonic`) and the `onyomi: []`
  hygiene note; `docs/plans/phase3-learning.md` 3E; CLAUDE.md Current State and README.
- **Built with the acceptance (Phase 3E):** `learning/kanji/` (`selection.ts`, `KanjiService`),
  the inverted `wordsByKanji` map in `IndexCacheService`, WOTD's `pickForDate`/`decidePin`/
  `pickReplacement` generalised with a kind seed, `kanji.acknowledged` + the `japanese-kanji`
  streak key in `packages/contracts`, and `apps/web/widgets/japanese-kanji/`. The widget is the
  first consumer of the shared widget primitives in `@command-center/ui` (`Button`, `Chip`,
  `WidgetMessage`, `Skeleton`, `useAnnouncer`, `WidgetBody`/`WidgetFooter`, `List`), which every
  other widget was moved onto in the same change so the dashboard reads as one design.

## Alternatives considered

- **A `words[]` field on the kanji shard (the plan's open question):** rejected — the relation
  is already in the index on the word side, where the vault keeps it; duplicating it onto the
  kanji record makes the indexer compute a join the API can do in one pass at load, and every
  word edit would then rewrite kanji records too. The inverted map costs one loop over ~19 000
  records at index load.
- **Substring match on `word` as the words source (every word containing the character):**
  rejected — it covers all 1 109 kanji but diverges from the note's own "Sanat joissa esiintyy"
  view (the user would see words on the dashboard that Obsidian does not list under the kanji),
  bypasses the `kanji` field as a curation signal, and for very common kanji floods the list with
  compounds that teach nothing about the reading shown. Kept as a documented fallback option if
  curation stalls.
- **Mnemonic from the body at request time (fetch the note through the Contents API):** rejected —
  one blob read per serve on the hot path, exactly the per-file read pattern ADR-040 refused;
  the index exists so reads never fetch notes.
- **Shipping the widget only once the mnemonic is indexed:** rejected — couples the monorepo
  step to a vault-side commit the product owner lands on their own schedule; the field is
  additive, so the card degrades to one fewer section.
- **Reusing `WotdService` with a kind parameter instead of a `KanjiService`:** rejected — the
  item shape, the eligibility predicate and the response type differ; a generic service would
  carry a union return type into every caller. Shared _functions_ are extracted; the service
  stays per kind, as grammar already is.
- **`meaningLanguage` setting for parity with WOTD/grammar:** rejected for v1 — a setting with
  no effect (no EN meaning on any kanji note) is a trap in the settings panel. Added when the
  vault grows EN lines; the response already carries `meaning.en` so no contract change is
  needed then.
- **Kanji streak folded into the `japanese-wotd` streak:** rejected — ADR-014's rule is one key
  per deliberate gesture, and a learner who does words but not kanji (or the reverse) should see
  that honestly. One event, one key.
- **A "mark shaky" third action:** rejected — the vault's `shaky` status is a review-time judgement
  made in Obsidian/Anki, not a first-exposure gesture; the dashboard keeps ADR-011's two verbs.
