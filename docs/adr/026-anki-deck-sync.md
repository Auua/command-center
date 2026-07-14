# ADR-026: Anki two-deck sync (Japanese + Tech) via AnkiWeb

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

Anna keeps two real Anki decks — **Japanese** and **Tech** — and wants them on every device.
That last part is not ours to build: AnkiWeb already syncs a collection to Anki's mobile and
desktop clients. What we must build is everything upstream of it — turning vault items
(ADR-024) into well-formed notes in the right deck, without duplicates, and showing Anna
honestly whether that has happened.

The hard constraint is already settled and is not reopened here (§4.5, R2, ADR-011):
**AnkiConnect is a plugin inside the _desktop_ Anki app on `localhost:8765`.** A cloud backend
can never reach it. AnkiWeb has no public API and **scraping it is forbidden** (ToS, R2). The
only path from our cloud to Anna's collection runs through her browser, on her desktop, while
Anki is open. ADR-011 therefore established queue-and-flush: adds are queued durably in the
API; the browser flushes them to AnkiConnect when it detects it; review stats are pushed back
client → API into `anki_snapshots`. That protocol stands. This ADR extends it from "one widget
adds a Basic note" to "two decks, two note types, deterministically mapped from the vault, and
pushed onward to AnkiWeb".

Two prior decisions need correcting, and nothing is implemented yet, so both are free:

- ADR-011 placed the Anki queue inside `JapaneseModule` (`/api/v1/japanese/anki/queue`) and
  ADR-013 has tech lessons posting to that Japanese endpoint — visibly wrong once a Tech deck
  exists.
- ADR-011's default `ankiNoteType` was `"Basic"`. Two fields cannot hold an expression, a
  reading, a meaning, an example, and a stable id.

## Decision

### Module ownership (supersedes ADR-011/013 placement)

We will extract an **`AnkiModule`** owning `anki_queue` and `anki_snapshots` (Mongo), serving
`/api/v1/anki/*`. It is deck-agnostic and vault-driven: its input is a vault item id, never a
Japanese word or a lesson. `JapaneseModule` and `LearningModule` keep their content; neither
owns Anki any more, and neither imports the other (§4.1). ARD §4.3's ownership row for
`anki_snapshots` (currently "Japanese") needs a follow-up edit.

**Every Anki note is created from a vault item.** "Add to Anki" implies a vault save (ADR-024)
— it is the vault id that makes the note addressable, deduplicable, and re-mappable forever.
There is no path that produces an Anki note without a vault item.

### Deck & note-type design

**Two top-level decks, named in settings** (defaults `Japanese`, `Tech`), mapped 1:1 from the
vault item's `deck` field (`japanese` | `tech`). **No subdecks.** Anki applies its scheduling
options and daily limits per top-level deck, which is exactly the granularity Anna asked for;
sub-classification (WOTD vs grammar, TypeScript vs SQL) rides as **tags** — `cc::japanese-wotd`,
`cc::grammar`, `cc::tech::typescript` — which filter and search just as well without multiplying
deck config. The `cc::` prefix keeps our tags from colliding with Anna's own.

Two **custom note types**, created by us, name-versioned so a field change is a new model and
never a destructive migration of Anna's existing notes:

| `CC Japanese v1`                      | `CC Tech v1`                       |
| ------------------------------------- | ---------------------------------- |
| `Expression` (first field)            | `Question` (first field)           |
| `Reading` — furigana bracket notation | `Answer`                           |
| `Meaning`                             | `Code` (pre-formatted, in `<pre>`) |
| `Example`, `ExampleEn`                | `Language`                         |
| `Source`                              | `SourceUrl`                        |
| `VaultId`                             | `VaultId`                          |

`VaultId` is the load-bearing field: it is our GUID. Anki's own note `guid` is not settable
through AnkiConnect's `addNote`, so we do not pretend to control it — we carry our identity in a
field we do control, and search on it (Anki supports field-scoped search: `VaultId:<uuid>`).

**Furigana** uses Anki's native convention rather than our own: the `Reading` field holds
bracket notation (`約束[やくそく]`) and the card template renders it with the built-in
`{{furigana:Reading}}` filter. ADR-011 already stores `rubySegments` at ingest, so the
conversion is a deterministic fold over those segments — no runtime tokenizer, and the reading
degrades to legible plain text in any client that lacks the filter.

Card templates ship with the model: Japanese generates recognition (Expression → Meaning) and,
optionally, recall (Meaning → Expression) cards; Tech generates one card (Question → Answer +
Code). `Code` is escaped and wrapped in `<pre>` at map time — Anki templates are HTML, and
un-escaped code in a card is both broken rendering and a (self-inflicted) injection.

### Mapping vault items → notes, and idempotency

Mapping reads ADR-024's structured `fields` block, **never the markdown body**. The map is a
pure function `(vaultItem, settings) → AnkiNote` living in `packages/contracts` so client and
API agree on it, with a golden-file test per deck.

Idempotency keeps ADR-011's **three layers**, with layer (b) upgraded from a fuzzy key to an
exact one:

1. **`clientRequestId`** on `POST /api/v1/anki/queue` — a retried click or a flaky POST cannot
   create two queue rows (unique per `(userId, clientRequestId)`).
2. **`findNotes` on `VaultId` before `addNote`** — the client queries
   `deck:"Japanese" VaultId:<uuid>`; a hit short-circuits to `PATCH … flushed` with the found
   note id. This is strictly better than ADR-011's headword+reading key: it is exact, it
   survives Anna editing the expression, and it removes that ADR's noted weakness ("note types
   whose first field isn't the word need mapping care").
3. **`duplicateScope: "deck"`** on `addNote` — Anki's own first-field dedupe as the final net.

A crash between `addNote` and `PATCH` is caught by (2) on the next flush. Re-syncing the whole
vault is therefore safe by construction: it converges, it does not duplicate.

Provisioning is part of the flush, not a setup wizard: before the first add of a session the
client ensures deck and model exist (`deckNames` → `createDeck`, `modelNames` → `createModel`).
A missing model is a normal state on a fresh machine, not an error.

### Triggering AnkiWeb sync

After a flush batch completes (not per note), the client calls AnkiConnect's **`sync`** action,
which triggers the desktop app's normal AnkiWeb sync — the same sync Anna would press `Y` for.
This is the only "make it available on all my devices" mechanism we use, and it requires nothing
from us but the call: Anki does the rest, and it presumes only that Anna is logged into AnkiWeb
in the desktop app. Debounced to at most one `sync` per flush batch and at most once per few
minutes, so a burst of adds is one sync, not twenty. A failed sync (not logged in, conflict
prompt open) is reported into the sync-status surface, never retried in a loop — the desktop app
owns conflict resolution and we must not fight it.

### Pulling review stats back

After a successful flush, and at most hourly on window focus, the client reads per-deck stats
(`deckNames`, `getDeckStats`, plus `findCards`/`cardsInfo` for the two decks) and pushes them to
`PUT /api/v1/anki/snapshot`. The server stamps `takenAt` and stores them in `anki_snapshots`
(§4.3, §4.4). This is the **only** picture the cloud ever has of Anki, and it is aggregate and
lagging by design — it is not a scheduling import, and per ADR-025 it never feeds the in-app
scheduler. It exists so the dashboard can tell the truth on a phone, where AnkiConnect does not
exist.

### "Synced for me": the status surface

Three honest states, surfaced in the learning widgets' footer and the review widget card:

- **Synced** — "Anki synced 8 min ago" (relative time from `lastSnapshotAt`, `Intl.RelativeTimeFormat`).
- **Pending** — "3 waiting for Anki" whenever the queue is non-empty. On mobile this is the
  normal, expected resting state, and the copy must not read as an error: pending means _next
  time you open Anki on your desktop_, not _something broke_.
- **Failed** — only for items that exhausted retries or hit a mapping error; these get an inline
  retry and never block the rest of the queue.

Never a spinner that implies live connectivity we do not have, and never a green tick on mobile
that we cannot actually verify.

### API contract

Under `/api/v1/anki` (moved from `/api/v1/japanese/anki`), JWT-guarded, zod contracts in
`packages/contracts` (ADR-004/007):

- `POST /queue` `{ clientRequestId, vaultItemId, deck }` → 201; replays return the existing
  record (200). The **server** maps the item to fields (single source of mapping truth); the
  client sends no note payload.
- `GET /queue?status=pending` → items to flush, each carrying its resolved deck, model, fields,
  tags, and `VaultId`.
- `PATCH /queue/:id` `{ status: 'flushed', ankiNoteId }` | `{ status: 'failed', lastError }`.
- `PUT /snapshot` → per-deck counts + `reviewsToday`, server-stamped.
- `GET /status` → `{ pending, failed, lastSnapshotAt, lastSyncAt }` — one fetch for the surface
  above.

A successful flush emits **`anki.note_created { userId, vaultItemId, deck, ankiNoteId }`**;
`ReviewModule` (ADR-025) listens and transfers `srs_owner` to `anki`, suspending the in-app card.
This event is the whole hinge between the two loops — one item, one scheduler.

## Consequences

- **Easier:** two decks stay coherent because both are generated from one vault mapping; a
  re-sync of the entire vault is safe and idempotent; "available on all my devices" costs us one
  `sync` call because AnkiWeb already solves it. Tech lessons stop posting to a Japanese
  endpoint.
- **Harder / committed to:** we own custom note types and card templates in Anna's collection.
  Changing a field means shipping `CC Japanese v2` and a migration decision (leave v1 notes
  alone, most likely) — versioned model names are what make that survivable. We also own an
  HTML-escaping obligation on `Code`.
- **Unchanged and accepted (R2):** nothing syncs while Anki is closed. Mobile adds queue,
  possibly for days. Review stats are as fresh as the last desktop session. This is a property of
  Anki's architecture, not a defect in ours, and the UI says so plainly rather than hiding it.
- **Supersedes:** ADR-011/013's `/api/v1/japanese/anki/*` endpoint placement and their
  `ankiNoteType: "Basic"` default; ADR-011's `findNotes` dedupe key (headword+reading → `VaultId`).
  ARD §4.3 needs a follow-up edit moving `anki_snapshots` to `AnkiModule`.
- **Open questions for Anna:** (1) Do the two decks already exist in your collection with content
  — do we need a one-time import of _existing_ notes into the vault, or does the vault start
  empty? (2) Recall (Meaning → Expression) cards for Japanese: on or off by default? (3) Deck
  names — literally `Japanese` and `Tech`, or nested under an existing parent deck you already
  use?

## Alternatives considered

- **Server-side sync (API → AnkiConnect):** impossible, not merely rejected — AnkiConnect binds
  to desktop localhost (§4.5). Restated here because it is the first thing everyone proposes.
- **AnkiWeb scraping / reverse-engineered sync client:** rejected on ToS grounds (R2), and it
  would put Anna's Anki credentials in our custody — a strictly worse security posture (§5.3) for
  a feature the desktop app performs for free.
- **`Basic` note type (ADR-011's original default):** rejected — two fields force expression,
  reading, meaning and example into concatenated HTML, destroy field-scoped dedupe, and make
  furigana a string-munging problem. Custom models cost one `createModel` call.
- **Subdecks (`Japanese::Grammar`, `Tech::TypeScript`):** rejected — Anki's options/limits apply
  per top-level deck, so subdecks would fragment exactly the scheduling knobs Anna wants to set
  once per deck; tags give the same filtering with none of that.
- **Anki note `guid` as the identity key:** rejected — not settable via AnkiConnect's `addNote`,
  so we would be asserting control we do not have. A `VaultId` field is settable, searchable, and
  ours.
- **Mapping vault markdown bodies to fields (parse on flush):** rejected — the body is generated
  prose for human reading; ADR-024 stores a structured `fields` block precisely so that no
  consumer ever parses markdown.
- **Client-composed note payloads (client sends fields to the queue):** rejected — two mapping
  implementations would drift, and it would let a compromised client write arbitrary content into
  the queue. The server maps; the client transports.
- **Importing Anki's scheduling state back into the app:** rejected for v1 — `getDeckStats` gives
  aggregates, not per-card memory state; a partial import would silently corrupt ADR-025's FSRS
  state. Ownership transfer is one-way, and honestly labelled as such.
