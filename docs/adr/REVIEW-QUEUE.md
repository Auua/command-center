# ADR review queue

Working list for the ADR approval walkthrough. Each ADR carries a `**Review:**` line in its header;
this table mirrors it so the state is visible in one place.

States:

- `new` — drafted, not yet checked.
- `claude-reviewed` — checked against the ARD's hard rails (§4.1 module boundaries, §4.3 data-ownership
  split, §4.2 widget SDK, §5 security, §6 NFRs) and against the other new ADRs for cross-references.
  Ready to walk through together.
- `approved` — the product owner signed off; the ADR's `Status:` flips to `accepted`.

Reviewing an ADR is not approving it: `claude-reviewed` means the decisions are internally consistent
and don't violate the architecture, **not** that they're the decisions the product owner will endorse.

## Batch 1 — new widgets (mock: `docs/design/new-widgets-mock.html`)

| ADR | Title                          | Review state    | Approved                 |
| --- | ------------------------------ | --------------- | ------------------------ |
| 019 | System-design micro-lesson     | claude-reviewed |                          |
| 020 | RSS feed (headlines, link out) | claude-reviewed | ✓ 2026-07-16 (rewritten) |
| 021 | Stock & FX watchlist           | claude-reviewed | ✓ 2026-07-16             |
| 022 | Weather forecast               | claude-reviewed | ✓ 2026-07-16             |
| 023 | Work tracker (perf review)     | claude-reviewed | ✓ 2026-07-16             |

**ADR-020 was rewritten at the 2026-07-16 walkthrough by product-owner decision** (the ADR-024/026
precedent): the drafted in-app reader (block-document bodies in Mongo, `/reader` route, image policy)
was more than the want — the accepted design is a classic RSS feed: headlines + plain-text excerpts
linking out to the publisher, unread/saved flags, Postgres only. The reader design survives in git
history as the starting point if in-app reading is ever wanted.

## Batch 2 — learning center

| ADR | Title                                   | Review state    | Approved |
| --- | --------------------------------------- | --------------- | -------- |
| 024 | GitHub learning-center repo (the store) | claude-reviewed |          |
| 025 | Spaced-repetition review widget         | claude-reviewed |          |
| 026 | Anki deck sync via learning-repo Action | claude-reviewed |          |

## Batch 3 — README future extensions

| ADR | Title                      | Review state    | Approved          |
| --- | -------------------------- | --------------- | ----------------- |
| 027 | Habit tracking             | claude-reviewed |                   |
| 028 | Pomodoro timer             | claude-reviewed |                   |
| 029 | Fitness & health           | claude-reviewed | ✓ 2026-07-16      |
| 030 | Finance dashboard          | claude-reviewed | parked 2026-07-16 |
| 031 | Home Assistant integration | claude-reviewed | parked 2026-07-16 |

## Batch 4 — public-API enhancements

Sweep of the existing + new ADRs for public APIs (`public-apis/public-apis` as the catalogue) that would
make a widget materially better. Every provider proposed below was called or had its terms fetched on
2026-07-14 before being written up; the "verified" column of each ADR records what was checked. Four ADRs,
not one per API — the sweep produced more candidates than it kept.

| ADR | Title                                           | Review state    | Approved            |
| --- | ----------------------------------------------- | --------------- | ------------------- |
| 032 | Content sourcing & licensing (learning widgets) | claude-reviewed |                     |
| 033 | Public holidays in the calendar                 | claude-reviewed |                     |
| 034 | FX from central-bank reference rates            | claude-reviewed | rejected 2026-07-16 |
| 035 | Transit departures widget (HSL/Digitransit)     | claude-reviewed |                     |

Three of the four **change ADRs that are already in this queue** — worth reading in that order:

- **ADR-032 closes ARD risk R5** (content sourcing/licensing) and supersedes the attribution _placement_ in
  ADR-011 and ADR-012: EDRDG's licence requires acknowledgement "on each screen display" for a web
  dictionary display, so the WOTD and grammar cards get a persistent footer line rather than an about-panel
  entry. It also narrows ADR-011's worker "content-pool refresh" job to a pinned CI ingest, and records that
  no open-licensed JLPT _grammar_ dataset exists (grammar stays authored) and that JLPT levels are curated
  approximations, not official.
- **ADR-033** adds a `public_holidays` reference table to ADR-018's calendar — deliberately _not_
  `calendar_events` rows.
- **ADR-034** moves the FX half of ADR-021's watchlist off the metered Twelve Data budget onto keyless ECB
  reference rates, and settles ADR-030's multi-currency conversion. It trades intraday FX for daily
  granularity — the one user-visible regression in the batch, and the thing to confirm first.
  _Confirmed 2026-07-16 and declined:_ **rejected** — the watchlist stays a current-data card on
  Twelve Data (one mixed FX + equities widget, per ADR-021), and the finance half went moot when
  ADR-030 was parked.
- **ADR-035** is the only _new_ widget, and the most speculative item here; it is also the only one that may
  poll a provider on read, under three stated conditions.

## Batch 5 — tasks & calendar upgrades (product-owner ask, 2026-07-16)

Two ADRs from one ask: recurring todos that also show on the calendar, and Google Calendar in the
dashboard with per-calendar read-only / read-write access.

| ADR | Title                                         | Review state    | Approved |
| --- | --------------------------------------------- | --------------- | -------- |
| 036 | Recurring tasks (+ calendar projection)       | claude-reviewed |          |
| 037 | Google Calendar sync (read-only / read-write) | claude-reviewed |          |

Both **change ADRs already in this queue or accepted work** — read in this order:

- **ADR-036 extends ADR-008** (new `tasks` columns, `every …` quick-add token, transactional
  respawn-on-completion) and **ADR-018's task overlay** (`projected: true` occurrences on the same
  endpoint). It also extracts ADR-018's RRULE expansion into a shared `packages/` recurrence
  utility consumed by both modules — a library, not a module import, so ADR-002 holds.
- **ADR-037 lifts ADR-018's external-sync deferral** for Google specifically, through the
  `source`/`external_id` seam ADR-018 left. ADR-033 is _not_ retired: holidays stay keyless — a
  public fact should not cost a private-token grant. The single decision most worth product-owner
  attention: sync freshness is a 10-minute worker poll (shown as "synced N min ago"), not push —
  and v1 cannot create/edit recurring _series_ on Google calendars (single events only; series
  stay edited in Google's UI).

## Batch 6 — nutrition (from the ADR-029 walkthrough, 2026-07-16)

One ADR from the product owner's calorie-tracking ask at the ADR-029 review: a personal food
library with one-tap logging and nullable-kcal entries ("tracking is the first step").

| ADR | Title                                         | Review state    | Approved     |
| --- | --------------------------------------------- | --------------- | ------------ |
| 038 | Nutrition widget (food log, calorie tracking) | claude-reviewed | ✓ 2026-07-16 |

The rails check ran at drafting time (RLS on both tables, no client-direct access, §4.3 split argued,
no cross-module imports — the energy-balance view composes over APIs). The ADR-029 walkthrough also
**changed ADR-029 itself** (accepted with: `workout_sets` relational table in v1, Withings as the
committed next integration ADR, metric registry seeded weight/sleep/steps/activity, CSV/GPX import
dropped) — the Withings sync ADR is owed next and will follow ADR-037's OAuth/worker pattern.

## Review notes (batch 5 pass)

Rails check as before, both hold: the Google refresh token is server-side only and encrypted at
rest (§5.2 secrets posture; client never sees it); new tables (`calendar_accounts`,
`calendar_sources`) carry RLS; `tasks`/`calendar_events` changes keep existing RLS; no
client-direct provider calls (sync runs in the worker; writes go API → Google); reject-at-the-door
RRULE validation mirrors ADR-018; NFR-8 unaffected (Google Calendar API is free at this scale,
recurrence adds zero infra). ADR-036's one-open-occurrence invariant is enforced by a partial
unique index (unrepresentable, not policed), consistent with the house pattern (ADR-027 PK marks,
ADR-018 CHECK). Cross-checked ADR-027's habits-vs-recurring-tasks boundary — ADR-036 states the
complementary rule rather than eroding it. The §5.3 threat-tier addition (write-capable Google
token after escalation) is the security item to confirm explicitly in the walkthrough.

## Review notes (batch 1–3 pass)

Checked and found consistent: house ADR structure and header block on all 13; no `dangerouslySetInnerHTML`
anywhere except as an explicitly rejected alternative; no client-direct database or provider access;
secrets custodied per §5.2 (market-data keys and the GitHub PAT are server-side only; the Home Assistant
token is deliberately browser-only and, notably, kept _out_ of `settingsSchema` so it can't reach
`widget_layouts`); RLS named on every new Postgres table; NFR-8 (≤ €20/mo) addressed in every ADR that
touches a paid surface.

One conflict found and fixed during review: ADR-019 (written in parallel with batch 2) pointed
"Add to Anki" at ADR-011's `POST /api/v1/japanese/anki/queue`, which ADR-026 superseded. (ADR-019
has since been re-aligned again to ADR-026's 2026-07-16 rewrite — see below.)

**ADR-024 and ADR-026 were rewritten on 2026-07-16 by product-owner decision** (planning session for the
learning-center v1 slice):

- ADR-024: the Mongo-record + GitHub-mirror design is replaced by **GitHub as the store** — the
  private `learning-center` repo holds the JMdict-derived word pool and the card files, read/written
  by `LearningModule` via the Contents API. No `vault_items`, no push queue, no reconcile job.
- ADR-026: the AnkiConnect queue-and-flush design is replaced by a GitHub Action in the learning
  repo (composite action in this monorepo) running the official `anki` library straight against
  AnkiWeb — no desktop in the loop; results land in `sync/state.json`, not a report endpoint; a
  dispatch-only import mode brings existing deck content into the repo.
- ADR-019, ADR-032 were edited in place to match; ADR-025 got a light touch and owes a full
  re-alignment when the review widget is picked up (all still unapproved). Setup steps live in
  `docs/runbook-learning-center.md`.

Deliberate supersessions to confirm during the walkthrough (they change already-written ADRs):

- ADR-026 (rewritten) removes ADR-011/013's AnkiConnect queue-and-flush entirely: no `anki_queue`,
  no browser↔Anki traffic; saving a card file (`anki: true` front-matter, deterministic
  `jp-<ent_seq>` id) _is_ "Add to Anki", and the learning repo's Action upserts notes keyed on it.
- ADR-025 supersedes ADR-012's "Anki _is_ the SRS" — the in-app review widget schedules with FSRS, and
  `srs_owner` guarantees an item is scheduled by exactly one of the two.
- These imply ARD edits (§4.3 loses the planned `vault_items`/`anki_snapshots` rows; §4.4 gains
  `review_cards` / `review_logs`; AnkiConnect leaves §4.5, the §2 diagram, §5.2 CORS, R2, and
  Phase 3), noted in ARD §7 and owed once these are approved.

## Review notes (batch 4 pass)

Same rails check as batch 1–3, and all four hold: the Digitransit key is server-side only (the widget
cannot reach the provider directly, by construction), the two keyless providers are proxied and cached
server-side rather than called from the browser, and no proposal puts a tracker or a third-party
analytics surface on a widget.

The load-bearing claim in this batch is a **licensing** one, so I verified it against the source rather
than the summary. EDRDG's licence page (fetched 2026-07-14) says verbatim: _"If a WWW server is providing
a dictionary function or an on-screen display of words from the files, the acknowledgement must be made
on each screen display, e.g. in the form of a message at the foot of the screen or page."_ ADR-032's
persistent card-footer attribution is therefore a legal requirement, not a stylistic preference — and the
about-panel placement in ADR-011/012 does not satisfy it. The ShareAlike consequence is the part worth
explicit product-owner attention: it travels with _distribution_, so a public learning vault (ADR-024) or a
shared AnkiWeb deck (ADR-026) would be encumbered. Keeping both private avoids the question entirely.

Further supersessions to confirm in the walkthrough:

- **ADR-032** supersedes the attribution _placement_ in ADR-011/012, and narrows ADR-011's worker
  content-refresh job to a pinned CI ingest.
- **ADR-034** supersedes the FX half of ADR-021's provider choice (Twelve Data → keyless ECB rates via
  Frankfurter). The user-visible cost — EUR/JPY becomes a daily reference rate, not an intraday tick — is
  the single thing in this batch most likely to be wrong for the user, so it should be confirmed first.
- **ADR-035** is the only genuinely new widget here and the most speculative; it says so itself. If "my
  phone already does that" is the answer, dropping it costs nothing else in the batch.
