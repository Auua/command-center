# ADR review queue

Working list for the ADR approval walkthrough. Each ADR carries a `**Review:**` line in its header;
this table mirrors it so the state is visible in one place.

States:

- `new` — drafted, not yet checked.
- `claude-reviewed` — checked against the ARD's hard rails (§4.1 module boundaries, §4.3 data-ownership
  split, §4.2 widget SDK, §5 security, §6 NFRs) and against the other new ADRs for cross-references.
  Ready to walk through together.
- `approved` — Anna signed off; the ADR's `Status:` flips to `accepted`.

Reviewing an ADR is not approving it: `claude-reviewed` means the decisions are internally consistent
and don't violate the architecture, **not** that they're the decisions Anna wants.

## Batch 1 — new widgets (mock: `docs/design/new-widgets-mock.html`)

| ADR | Title                      | Review state    | Anna |
| --- | -------------------------- | --------------- | ---- |
| 019 | System-design micro-lesson | claude-reviewed |      |
| 020 | Post reader (RSS/Atom)     | claude-reviewed |      |
| 021 | Stock & FX watchlist       | claude-reviewed |      |
| 022 | Weather forecast           | claude-reviewed |      |
| 023 | Work tracker (perf review) | claude-reviewed |      |

## Batch 2 — learning center

| ADR | Title                            | Review state    | Anna |
| --- | -------------------------------- | --------------- | ---- |
| 024 | GitHub learning vault            | claude-reviewed |      |
| 025 | Spaced-repetition review widget  | claude-reviewed |      |
| 026 | Anki deck sync (Japanese + Tech) | claude-reviewed |      |

## Batch 3 — README future extensions

| ADR | Title                      | Review state    | Anna |
| --- | -------------------------- | --------------- | ---- |
| 027 | Habit tracking             | claude-reviewed |      |
| 028 | Pomodoro timer             | claude-reviewed |      |
| 029 | Fitness & health           | claude-reviewed |      |
| 030 | Finance dashboard          | claude-reviewed |      |
| 031 | Home Assistant integration | claude-reviewed |      |

## Batch 4 — public-API enhancements

Sweep of the existing + new ADRs for public APIs (`public-apis/public-apis` as the catalogue) that would
make a widget materially better. Every provider proposed below was called or had its terms fetched on
2026-07-14 before being written up; the "verified" column of each ADR records what was checked. Four ADRs,
not one per API — the sweep produced more candidates than it kept.

| ADR | Title                                           | Review state    | Anna |
| --- | ----------------------------------------------- | --------------- | ---- |
| 032 | Content sourcing & licensing (learning widgets) | claude-reviewed |      |
| 033 | Public holidays in the calendar                 | claude-reviewed |      |
| 034 | FX from central-bank reference rates            | claude-reviewed |      |
| 035 | Transit departures widget (HSL/Digitransit)     | claude-reviewed |      |

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
- **ADR-035** is the only _new_ widget, and the most speculative item here; it is also the only one that may
  poll a provider on read, under three stated conditions.

## Review notes (batch 1–3 pass)

Checked and found consistent: house ADR structure and header block on all 13; no `dangerouslySetInnerHTML`
anywhere except as an explicitly rejected alternative; no client-direct database or provider access;
secrets custodied per §5.2 (market-data keys and the GitHub PAT are server-side only; the Home Assistant
token is deliberately browser-only and, notably, kept _out_ of `settingsSchema` so it can't reach
`widget_layouts`); RLS named on every new Postgres table; NFR-8 (≤ €20/mo) addressed in every ADR that
touches a paid surface.

One conflict found and fixed during review: ADR-019 (written in parallel with batch 2) pointed
"Add to Anki" at ADR-011's `POST /api/v1/japanese/anki/queue`, which ADR-026 supersedes with the
deck-agnostic `AnkiModule` at `/api/v1/anki/*`, keyed by vault item id. ADR-019 now matches.

Deliberate supersessions to confirm during the walkthrough (they change already-written ADRs):

- ADR-026 moves the Anki queue out of `JapaneseModule` (was ADR-011/013) into a new `AnkiModule`, and
  upgrades ADR-011's `findNotes` dedupe key from headword+reading to the exact vault id.
- ADR-025 supersedes ADR-012's "Anki _is_ the SRS" — the in-app review widget schedules with FSRS, and
  `srs_owner` guarantees an item is scheduled by exactly one of the two.
- Both imply ARD edits (§4.3 `anki_snapshots` ownership; §4.4 gains `review_cards` / `review_logs`),
  noted in ARD §7 and owed once these are approved.

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
Anna's explicit attention: it travels with _distribution_, so a public learning vault (ADR-024) or a
shared AnkiWeb deck (ADR-026) would be encumbered. Keeping both private avoids the question entirely.

Further supersessions to confirm in the walkthrough:

- **ADR-032** supersedes the attribution _placement_ in ADR-011/012, and narrows ADR-011's worker
  content-refresh job to a pinned CI ingest.
- **ADR-034** supersedes the FX half of ADR-021's provider choice (Twelve Data → keyless ECB rates via
  Frankfurter). The user-visible cost — EUR/JPY becomes a daily reference rate, not an intraday tick — is
  the single thing in this batch most likely to be wrong for Anna, so it should be confirmed first.
- **ADR-035** is the only genuinely new widget here and the most speculative; it says so itself. If "my
  phone already does that" is the answer, dropping it costs nothing else in the batch.
