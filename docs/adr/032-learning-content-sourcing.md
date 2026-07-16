# ADR-032: Content sourcing & licensing for the learning widgets

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

ARD §8 **R5** — _"Content sourcing for WOTD/lessons (licensing, quality) — learning widgets are the heart
of the product"_ — is the oldest open risk in the document, and four ADRs have now been written on top of
it without closing it:

- **ADR-011** (Japanese WOTD) names JMdict and CC BY-SA, and specifies a worker job "ingesting/refreshing
  `jp_content` from external sources" — without ever saying which sources, in what form, or from where.
  It also specifies `rubySegments` "precomputed at ingest" without naming what they are computed _from_.
- **ADR-012** (grammar) carries the gap forward literally: its document schema contains
  `"license": { "name": "…", "attribution": "…" }` — an ellipsis where a licence should be.
- **ADR-013** (tech lessons) and **ADR-019** (system design) assume authored content and record
  `source: { attribution?, license? }` as _optional_ fields.
- **ADR-011/012** both place attribution in the widget's about panel, "off the card, but one tap away".

So the widgets have a content pipeline with a hole in the middle. Forces:

- **Licensing is a legal obligation, not a nicety.** R5 says so, and the EDRDG licence turns out to make
  a demand about _placement_ that ADR-011's about-panel rule does not satisfy (see below). This is the
  finding that makes this ADR worth writing rather than a wiki page.
- **The read path is already decided and must not be reopened.** ADR-011 rejected "third-party dictionary
  API as the live read path" and ARD §2's failure table says content-source outages degrade to the
  pre-seeded cache. So the question is _not_ "which dictionary API do we call" — it is "what do we ingest,
  from where, under what terms, and how do we prove it later".
- **NFR-8 / G2.** Whatever we choose must cost nothing and need no babysitting.
- **Quality is the product (G3).** A learning dashboard that teaches wrong readings is worse than no
  learning dashboard.

## Decision

### Provider choice — we ingest **release artefacts**, not call APIs

The correct shape for every source below is a **pinned, versioned file download**, not a runtime HTTP
call. Dictionary data is large, static, and republished on a slow cadence; an API in front of it is a
middleman that adds a failure mode, a rate limit and a dependency to a file we are allowed to download.
This ADR therefore proposes **no new runtime provider at all** for the learning widgets — which is the
strongest possible answer to R5's "if unavailable" column.

Verified sources:

| Source                                                          | What it gives us                                                     | Auth | Distribution                                                                         | Licence                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **jmdict-simplified** (`github.com/scriptin/jmdict-simplified`) | JMdict (words, senses, POS), JMnedict, KANJIDIC2, Kradfile — as JSON | none | GitHub Releases, **rebuilt automatically every Monday**; tags like `3.6.2+2026…`     | JMdict/JMnedict: **EDRDG Licence = CC BY-SA 4.0**; KANJIDIC2: CC BY-SA 4.0 |
| **JmdictFurigana** (`github.com/Doublevil/JmdictFurigana`)      | kanji→kana alignment per entry — i.e. **ADR-011's `rubySegments`**   | none | GitHub Releases, rebuilt monthly (25th); JSON + compact text                         | **CC BY-SA** (follows JMdict)                                              |
| **Tatoeba** (`tatoeba.org/en/downloads`)                        | JA↔EN example sentence pairs — **ADR-011's `examples[]`**            | none | Bulk downloads (sentences, links, sentence pairs); an API exists but we don't use it | **CC BY 2.0 FR** (some sentences CC0)                                      |

Verified by fetching `edrdg.org/edrdg/licence.html`, both GitHub project pages, and `tatoeba.org/en/downloads`
on 2026-07-14. All three permit personal _and_ commercial use provided attribution (and, for the BY-SA
ones, ShareAlike) are honored. **None of them forecloses a future productization** — unlike Open-Meteo's
non-commercial free tier (ADR-022), which is worth stating because it means the _learning_ half of the
product, the half that is actually the point, carries no commercial-use landmine.

### Two things that do **not** exist, and the decisions that follow

These are findings, and they are half the value of this ADR:

1. **There is no authoritative JLPT vocabulary/kanji/grammar list.** The JLPT stopped publishing its
   _Test Content Specification_ (出題基準) with the 2010 revision and has published no official word or
   kanji lists since; every "N3 vocabulary list" in circulation is a community reconstruction. JMdict does
   not carry a JLPT field.

   **Decision:** ADR-011's `jlptLevel` and ADR-012's `level` are **our curated annotations**, seeded from a
   community list whose provenance is recorded per item, and the UI must not present them as official. The
   message catalog says **"≈ N4"**, not "N4". A learning app that lies about the exam is a bad learning app,
   and the honesty is one string.

2. **There is no open-licensed JLPT _grammar_ dataset.** What exists is either an unlicensed scrape or
   proprietary (Bunpro, WaniKani — see Alternatives).

   **Decision:** **grammar content is authored by us** (ADR-012 already implied this with its curated
   `sequence` field; this ADR makes it the decision rather than an omission). Same for tech lessons
   (ADR-013) and system-design lessons (ADR-019). Their `license.spdx` is `proprietary-own` and their
   `source` is `command-center` — which is a real, recordable answer, not a blank.

Net: **Japanese vocabulary is ingested; everything else is authored.** R5 closes not by finding one big
content API but by discovering that half the content has an excellent free source and half has none.

### Integration shape — a pinned CI ingest, not a worker poll

This **narrows ADR-011's worker "content-pool refresh" job**: there is no recurring worker job for content.

- Ingest is a **script run in CI (or by hand), against a pinned release tag**: download → validate →
  transform → emit. Bumping the pin is a PR, and therefore reviewable, revertable, and visible in git —
  which is the correct control for the data that _is_ the product. _(Revised 2026-07-16 with ADR-024's
  rewrite: the v1 target is the learning repo's `pool/japanese/` — manifest + JSONL shards emitted by
  `tools/jmdict-ingest` and committed by Anna — not Mongo `jp_content`. If the daily-content widgets
  of ADR-011/012 later need a server-side store, that is their migration to propose; the pinned-ingest,
  fail-closed, licence-typed rules here apply to either target.)_
- Why not a worker cron: dictionary data changes weekly and nobody would notice if we were a year behind,
  while a cron that downloads a multi-megabyte JSON into a €0 backend on a schedule is a real operational
  hazard for zero user-visible benefit (G2). The ARD's §2 promise "content sources down → serve pre-seeded
  cache" becomes vacuously true: there is only the cache. Nothing to be down.
- Ingest **fails closed**: a document without a complete `license` block, a `rubySegments` alignment that
  doesn't reconstruct the headword, or an example sentence whose Tatoeba id doesn't resolve, is rejected
  and the previous content stays. A bad release is a red CI run, never a broken card.
- ADR-011's on-read day-pinned selection is untouched; ADR-012's `sequence` curation is untouched.

### Data model — the `license` block becomes required and typed

ADR-012's `"license": { "name": "…" }` placeholder is replaced. Every document in `jp_content`
(ADR-011/012) and `lesson_content` (ADR-013/019) carries:

```ts
license: {
  spdx: 'CC-BY-SA-4.0' | 'CC-BY-2.0-FR' | 'CC0-1.0' | 'proprietary-own';
  source: 'JMdict' | 'JMnedict' | 'KANJIDIC2' | 'JmdictFurigana' | 'Tatoeba' | 'command-center';
  sourceRef: string; // JMdict ent_seq, Tatoeba sentence id — the row we came from
  release: string; // the pinned release tag, e.g. "jmdict-simplified@3.6.2+20260713141310"
  attribution: string; // the exact string we are obliged to display
  url: string; // where a reader verifies all of the above
}
```

A single document may carry **several** provenances (a JMdict headword + JmdictFurigana ruby + a Tatoeba
example), so `license` is an **array** on the document and the strictest term wins for the document as a
whole. Ingest computes that. A `content_sources` collection holds one row per source × release — its
licence, its attribution string, its URL, the date we pinned it — and it is what the about page renders.
`sourceRef` finally gives ADR-011's field a defined meaning: it is how, two years from now, we answer
"where did this word come from and under what terms".

### API contract

No new endpoints. `GET /japanese/wotd`, `/japanese/grammar/today` and `/lessons/today` gain one field:

```ts
attribution: {
  line: string;
  sources: {
    name: string;
    licence: string;
    url: string;
  }
  [];
}
```

`line` is the short string the card must render (below); `sources` is the long form for the about panel.
It is served from the API rather than hardcoded in the client for the same reason ADR-022 serves the
weather `label` from the server: FE and BE must not be able to disagree about a legal obligation, and a
new source must not require a frontend deploy to be credited.

### Failure & rate-limit posture

There is no runtime provider, therefore no rate limit, no key, no quota, no outage, and no entry in ARD
§2's dependency table. The only failure mode is a failed ingest, which is a CI failure and leaves the last
good content in place. This is the entire reason for the shape.

### Licensing & attribution — the correction to ADR-011 and ADR-012

The EDRDG licence says, verbatim:

> "If a WWW server is providing a dictionary function or an on-screen display of words from the files, the
> acknowledgement must be made on **each screen display**, e.g. in the form of a message at the foot of the
> screen or page."

and, for apps, that a menu screen such as "About" is acceptable but "it is not sufficient just to mention
it on a start-up/launch page".

Command Center is a **web** dashboard that displays dictionary entries. ADR-011 and ADR-012 put attribution
in the widget's about panel only — **that does not satisfy the licence.** So:

- **The WOTD and grammar cards carry a persistent, visible attribution line** — `"JMdict · EDRDG ·
CC BY-SA"` — in the same footer slot ADR-021 uses for "not investment advice". It is one line of small
  text, it is always on screen while the word is, and it is a licence obligation, not decoration. The about
  panel keeps the full `sources` list (which the licence also asks for). This supersedes the placement rule
  in ADR-011's UX section and ADR-012's Consequences.
- The licence's relaxation for _mixed_ sources ("a general acknowledgement is sufficient") is deliberately
  **not** leaned on. The WOTD card is a dictionary display in the plain meaning of the phrase, and building
  a legal argument to avoid rendering eleven characters is not a good use of anyone's afternoon.
- Tatoeba examples add `"Examples: Tatoeba · CC BY"` to the same line when an example is shown.

**ShareAlike is the sharp edge.** JMdict is CC BY-**SA** 4.0, so our derived `jp_content` documents
(ruby alignment, curated JLPT tags, curated example selection) are adaptations. Consequences we accept and
must not forget:

- **Distribution triggers SA, use does not.** Rendering to Anna is not distribution. Three things could be:
  1. **NFR-7's export endpoint** — a JSON dump containing `jp_content`-derived fields must carry the licence
     block (it already will, since `license` is on the document — this is a second reason the field is
     required rather than optional).
  2. **ADR-024's GitHub learning vault** — the repo is **private**, so no distribution occurs. If it is ever
     made public, JMdict-derived fields in a saved item become SA-encumbered and the repo must carry CC BY-SA.
     Recorded here so that "make the vault public" is a decision with a known consequence rather than a
     surprise.
  3. **ADR-026's Anki decks** — cards in Anna's personal collection are private use. **Sharing a deck on
     AnkiWeb is distribution**, and such a deck's description must carry the JMdict attribution.
- Mixing CC BY-SA (JMdict) with CC BY 2.0 FR (Tatoeba) in one document makes the **document** BY-SA. Our own
  authored lessons stay unencumbered because they never touch JMdict.

## Consequences

- **R5 closes.** Every learning document will carry a machine-readable, validated provenance, and the ARD's
  R5 row can be marked decided with a pointer here.
- **Easier:** the learning widgets acquire no new dependency, no key, no quota and no upstream availability
  risk — the strongest possible answer to a sourcing risk is to have nothing to be unavailable.
- **Easier:** "which JMdict build is this word from" is answerable, forever, from the document itself.
- **Harder / committed to:** an ingest pipeline is now real infrastructure (download, validate, transform,
  pin, upsert) with fail-closed validation, and bumping a source is a reviewed PR. This is the cost of
  content quality being the product.
- **Harder / committed to:** **an always-visible attribution line on the WOTD and grammar cards.** It is a
  small permanent tax on the most glanceable surface in the app, and it supersedes ADR-011/012's about-panel
  placement. Not optional, not negotiable, not a footnote.
- **Committed to:** grammar, tech and system-design content is **authored** — there is no rescue from a
  dataset later, and the curriculum backlog is a real, ongoing authoring commitment (ADR-013 already called
  this "a real content pipeline"; this ADR confirms there is no shortcut).
- **Committed to:** JLPT levels are approximations and are labelled as such (`≈ N4`).
- **Committed to:** ShareAlike travels with any distribution of derived content — export, a public vault, a
  shared Anki deck.
- **Open questions for Anna:** (1) The Japanese content is BY-SA and the authored content is ours — do we
  want the ingest to keep them in separate collections to make a future "publish the curriculum" clean, or
  is the per-document licence block enough? (2) Which community JLPT list do we seed levels from, and is
  "≈ N4" acceptable UI copy or should levels be hidden entirely until curated? (3) The attribution line on
  the card — confirm you're happy with it, because it is the one visible cost of this ADR and it lands on
  the prettiest card in the dashboard.

## Alternatives considered

- **Jisho.org's unofficial API as the content source.** The obvious first thought, and rejected twice over:
  it publishes no terms of use and no rate limit and offers no stability guarantee (it is an undocumented
  endpoint behind a website, the same class of dependency ADR-021 refused when it rejected Yahoo Finance
  scraping) — and, decisively, **its data _is_ JMdict**. Taking an unversioned, unlicensed HTTP dependency
  on a middleman in front of a file we are explicitly licensed to download is strictly worse on every axis.
- **WaniKani's API as a vocabulary/kanji source.** Rejected on licensing, not on quality (the content is
  excellent): WaniKani's content is Tofugu's copyright, its terms grant no redistribution licence, and the
  content is a subscription product. Ingesting it into our Mongo would be an infringement wearing an API
  key. Verified against `wanikani.com/terms`.
- **A live dictionary API on the read path** (any provider). Already rejected by ADR-011; re-rejected here
  with the extra reason that it would reintroduce the very availability/licensing risk (R5) this ADR exists
  to close.
- **A worker cron that polls GitHub Releases for new dictionary builds.** Rejected: it converts a reviewed,
  pinned, revertable content bump into an unattended production write of the app's most important data. The
  upside — being at most a week fresher on a dictionary that has been stable for decades — is not an upside.
- **Machine-generating grammar points / lessons with an LLM.** Rejected: the output has no provenance to
  record, no licence to cite, and no reviewer; R5's second word is "quality", and a plausible-sounding wrong
  grammar explanation is precisely the failure this ADR is meant to prevent. (Using an LLM as an _authoring
  assistant_ whose output Anna reviews and signs is fine — that produces `proprietary-own` content with a
  human author, which is a different thing.)
- **Scraping a grammar reference site.** Rejected on the same ToS principle the ARD applies to AnkiWeb (R2)
  and ADR-021 applies to Yahoo — a line we do not cross even when it is convenient.
- **Making `license` optional (status quo of ADR-013/019).** Rejected: an optional provenance field is an
  absent provenance field, and the failure only surfaces on the day someone asks a question we can no longer
  answer. Ingest fails closed instead.
- **Attribution in the about panel only (status quo of ADR-011/012).** Rejected: it does not satisfy the
  licence text for a web display of dictionary entries. The card gets a footer line.
