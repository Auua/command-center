# ADR-030: Finance dashboard widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

The README lists a finance dashboard under Future Extensions; the ARD names it in G4. Nothing is implemented — this is a planning ADR.

Two questions dominate, and everything else follows from them.

**1. Bank integration or not.** "Finance dashboard" invites automatic transaction sync via an open-banking aggregator (Nordigen/GoCardless, Tink, Plaid, TrueLayer). The consequences of saying yes:

- **Cost.** PSD2 aggregators are commercial products. GoCardless has a free tier with per-connection limits; Tink/Plaid are enterprise-priced. Any of them is a real dependency against **NFR-8 (≤ €20/mo total infra)** and G2 (must survive weeks of neglect — bank connections expire every 90 days under SCA and need re-consent).
- **Threat model.** It puts a live, refreshable authorization to read Anna's real bank accounts inside a personal hobby project's blast radius (§5). Today, ARD §5.3's worst case is "a compromised automation can annoy, not exfiltrate". A bank-linked finance module makes the worst case _"an attacker reads your full transaction history"_ — the most identity-revealing dataset in the app, worse than journal in some respects (it locates you in space and time).
- **Ops.** Consent renewal, webhook/poll infra, per-institution quirks, and a silent-staleness failure mode. This is ADR-018's rejected calendar-sync bundle, with money attached.

**2. Boundary with the stocks widget.** **ADR-021 (in progress, being written in parallel)** covers a stocks widget. Overlap is inevitable unless the line is drawn explicitly, so: **stocks = market data (a watchlist of instruments Anna does not necessarily own, prices from a public API, no personal financial position); finance = Anna's own money (balances, spending, budgets).** They are separate modules, separate tables, separate widgets. A future "portfolio value" feature — Anna's actual holdings, priced with market data — would be the _composition_ of the two and belongs in **this** module (it is her money), consuming market prices via the API layer, never by importing `StocksModule` (§4.1). Flagged as Q-B.

Third force: privacy. Financial data belongs in the **§5.3 highest-value asset tier** alongside journal, mood, and (per ADR-029) health. This ADR says so explicitly.

## Decision

### Scope: manual + CSV import, no bank connections

We will ship **manually maintained account balances and CSV-imported transactions**. **Open-banking / bank-aggregator integration is explicitly deferred** and requires a _new ADR plus a §5 threat-model revision_ before it can be reconsidered — it is not a backlog item that can be quietly picked up.

Why manual/CSV wins for v1: every European bank exports CSV, the import is a parser we own end-to-end (no vendor, no cost, no credentials, no consent expiry), and the resulting data answers the actual questions ("what did I spend this month, on what, and is the trend bad?") just as well. The failure mode of a stale CSV is "I haven't imported this month" — visible, recoverable, and not a security event.

**No credential custody, ever, in any form.** We will not store bank passwords, aggregator tokens, or screen-scraping sessions. This is a _rule_, not a v1 shortcut.

### CSV import design

The import is the module's one piece of real logic, and the part that must not be sloppy:

- **Upload is client → API (`POST /api/v1/finance/import`, multipart); parsing is server-side.** Client-side parsing would put mapping logic in the bundle and leave the server trusting client-shaped rows — the API is the authorization and validation boundary (ADR-004, §5.2).
- **Two-phase: preview then commit.** Phase 1 parses and returns `{ importId, detectedFormat, rows, newCount, duplicateCount, unparsedCount }` without writing; phase 2 (`POST /import/:importId/commit`) writes. A user must never discover an import doubled their spending _after_ it has.
- **Column mapping is a stored, named profile** (`import_profiles`) — bank CSVs differ in delimiter, decimal separator (`,` vs `.`, a European trap), date format, sign convention, and encoding (Latin-1 is still out there). Map once per bank; later files auto-detect by header fingerprint. **Amounts parse to integer minor units (cents), never floats** — float money is a bug with a schedule.
- **Dedupe is a content hash, not a guess:** `dedupe_hash = sha256(account_id | booked_on | amount_cents | normalized_description | occurrence_index)`, with `UNIQUE (user_id, account_id, dedupe_hash)`. Re-importing an overlapping range is idempotent by construction — the same "duplicate is unrepresentable" pattern as `streak_days` (ADR-014), `habit_marks` (ADR-027), `pomodoro_sessions.client_key` (ADR-028). The `occurrence_index` exists because two genuinely identical rows on one day (two €3.20 coffees at the same shop) would otherwise collide and silently lose one; the preview surfaces "2 identical rows" for confirmation.
- Uploaded files are **parsed and discarded** — never persisted. The transactions are the artifact; the CSV is not.

### Frontend

One folder `apps/web/widgets/finance/`, one registry entry (§4.2):

- `id: "finance"`, `sizes: ["2x2", "4x2", "4x3"]`; standard error + suspense boundaries.
- Card body: net balance across accounts **with an as-of date** (manual balances go stale — a balance without a date is a lie, so the staleness indicator is non-negotiable), this month's spending vs last, and a small category breakdown.
- `quickActions: [{ id: "import-csv", … }, { id: "update-balance", … }]`; `settingsSchema` (zod): `{ currency: string (default "EUR"), hideAmounts: boolean (default false), primaryAccountIds: string[], trendMonths: 3 | 6 | 12 (default 6) }`.
- **`hideAmounts` (privacy blur)** — a one-tap toggle rendering amounts as `••••`, honoured on first paint. A dashboard is a thing you leave open on a shared screen; this is the cheapest real privacy feature in the app.
- The full ledger, import wizard, and category rules live at **`/finance`** (a real route — ADR-018's widget-vs-destination split). A transaction table is not a dashboard card.
- Data via generated hooks in `packages/contracts` (ADR-007); no direct Supabase access (ADR-004).

### Backend

A new `FinanceModule` (domain module, §4.1): controller → service (parsing, categorisation, aggregation) → own repository. Imports no other domain module; a future portfolio view composes market data at the API layer, not by importing `StocksModule` (ADR-021).

- Emits `finance.import_completed` (`{ userId, importId, inserted, skipped }`) for the notification bell / automations (ADR-015). No streak wiring: "days you looked at your spending" is not a habit worth gamifying.
- Aggregations (monthly totals, per-category sums) are **SQL, server-side**, in the home timezone — raw ledgers never cross the wire for a chart (NFR-2; the ADR-009 lesson, applied from the start as in ADR-029).
- **Categorisation is rule-based and local**: ordered user-owned `(pattern → category)` rules applied at import, category stored on the row and hand-overridable. No ML, no third-party enrichment API — that would mean _sending transaction descriptions to a vendor_, flatly incompatible with the privacy posture below.

### Data model

Postgres, owned solely by `FinanceModule`, RLS `user_id = auth.uid()` (§5.1):

```sql
accounts (
  id            uuid PK default gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users,
  name          text NOT NULL,             -- "Everyday", "Savings" — user's own label
  kind          text NOT NULL,             -- "checking" | "savings" | "credit" | "cash"
  currency      char(3) NOT NULL DEFAULT 'EUR',
  balance_cents bigint NOT NULL DEFAULT 0, -- manually maintained
  balance_as_of date NOT NULL,             -- staleness is visible, always
  archived_at   timestamptz
);

transactions (
  id           uuid PK default gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users,
  account_id   uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  booked_on    date NOT NULL,              -- a bank booking date is a DATE, never a timestamp
  amount_cents bigint NOT NULL,            -- signed: negative = spend. Integer minor units, never float
  currency     char(3) NOT NULL,
  description  text NOT NULL,              -- SENSITIVE: merchant names locate you in space and time
  category     text,                       -- nullable = uncategorised
  source       text NOT NULL DEFAULT 'csv',-- 'csv' | 'manual'  (seam for a future importer)
  dedupe_hash  text NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id, dedupe_hash)
);

import_profiles ( id, user_id, name, header_fingerprint, column_map jsonb, decimal_sep, date_format, encoding );
budgets ( id, user_id, category, month, limit_cents );   -- optional, opt-in
```

Decisions embedded: **`bigint` cents, never `numeric`/`float`** (integers make rounding drift unrepresentable). **`booked_on` is a `date`**, not `timestamptz` — the ADR-018 all-day-event lesson: a bank's booking date is a calendar date and must never be timezone-converted. **No FX in v1** — multi-currency accounts are stored in their own currency and _not_ summed across currencies (the card shows per-currency totals rather than inventing a rate). Indexes: `(user_id, booked_on desc)`, `(user_id, category, booked_on)`.

### API contract

Under `/api/v1/finance`, zod in `packages/contracts`, `.strict()` writes, `user_id` always from the JWT:

- `GET /accounts`, `POST /accounts`, `PATCH /accounts/:id` (balance update sets `balance_as_of`).
- `POST /import` (multipart, ≤ 5 MB, `text/csv` only) → preview; `POST /import/:importId/commit` → `{ inserted, skipped }`. Previews expire (in-memory/short-TTL, never on disk).
- `GET /transactions?from&to&category&accountId` — required range, max 366 days (ADR-018's cap pattern), paginated.
- `PATCH /transactions/:id` — category override only; amounts/dates are import-derived and immutable (a hand-edited amount is a lie about the bank statement).
- `GET /summary?months=N` — SQL-aggregated monthly totals + per-category breakdown.
- `GET /export` — full ledger as JSON/CSV (NFR-7: the data stays Anna's).

### Accessibility

- The category breakdown follows the ADR-009 / ADR-029 house pattern: `role="img"` with a summarising `aria-label`, **plus a visually-hidden data table** (`category / amount / share`), no hover-only tooltips, value encoded by length/position rather than hue (WCAG 1.4.1). A **pie chart is rejected** in favour of a sorted horizontal bar list — the bars _are_ the table, comparable without color.
- The ledger is a real `<table>` with `<th scope>` headers, not a div grid. Sign is never conveyed by color or alignment: negatives carry an explicit `−` and are announced ("minus 42 euros 10"). Money via `Intl.NumberFormat(locale, { style: "currency" })` (NFR-12) — never a hardcoded `€`.
- The import wizard is a stepped form: step indicator, focus moved to each step's heading, parse errors as focusable links to the offending row (`role="alert"` summary), preview table fully keyboard-navigable. No bar-grow or count-up animation under `prefers-reduced-motion` (NFR-11).
- **`hideAmounts` must not be only visual** — hidden amounts are removed from the accessible name ("amount hidden"), or a screen reader reads out exactly what the screen is hiding.

### Privacy

Financial data is a **highest-value asset (§5.3 tier — with journal, mood, and health per ADR-029)**; transaction descriptions are arguably the most _identifying_ data in the app (they place a named person at a location on a date). Hard rules:

- **No third-party analytics or trackers on finance routes, ever** (NFR-7) — the ADR-009 rule, inherited.
- **No third-party enrichment/categorisation service** — sending merchant strings to a vendor exports the sensitive column for cosmetic gain. Local rules only.
- **No amounts or descriptions in notification payloads** (§5.2): "Import finished", never "You spent €412 at …". Push bodies transit vendor services.
- Server logs record row counts, import ids, and error codes — **never** descriptions or amounts; parser errors log the _column_, not the _value_.
- Uploaded CSVs are never persisted — no file lands on disk or in object storage.

### Open questions for Anna

- **Q-A:** Is CSV import worth building at all, or is "manual balances + a monthly spending figure" enough for v1? The import is ~70% of the effort. If the honest answer is "I'd check it monthly", the smaller version may be right.
- **Q-B (boundary with ADR-021, in progress):** where do _owned_ holdings live? Proposal: portfolio positions are Anna's money → `FinanceModule`; instrument prices are market data → `StocksModule`, composed at the API layer. Confirm before either is implemented — it decides which module owns a `holdings` table.
- **Q-C:** should `hideAmounts` default to **on**? One tap to reveal; saves the shared-screen case.
- **Q-D:** budgets — genuinely wanted, or the feature every finance app has and nobody uses? Left in the schema, out of the v1 UI unless Anna says otherwise.

## Consequences

- Zero external dependencies, zero cost, zero credential custody: the widget stays inside NFR-8 and doesn't move the §5 threat model. The worst case for a compromised finance module remains "read data already in our DB" — bad, but bounded, and covered by the same RLS/2FA/no-analytics controls as journal and mood.
- Manual balances go stale; we make that visible (`balance_as_of` everywhere) rather than pretending to freshness we don't have. Owning the CSV parser means owning the long tail of bank formats — the stored import profile makes that a one-time cost per bank, not a recurring one.
- Integer cents and `date` booking days make two classic money bugs (float drift, timezone-shifted transactions) unrepresentable rather than tested-for.
- **Committed to:** no bank aggregator without a new ADR _and_ a §5 threat-model revision; no third-party enrichment of transaction text; no analytics on finance routes — permanently.
- The stocks/finance boundary (market data vs my money) means a future "portfolio" needs explicit API-layer composition instead of a convenient module import — slightly more code, but it keeps §4.1 boundaries intact and lets stocks stay a credential-free market-data widget.

## Alternatives considered

- **Open-banking aggregator (GoCardless/Nordigen, Tink, Plaid, TrueLayer) in v1.** Rejected: recurring cost against NFR-8; 90-day SCA re-consent breaks the "survives weeks of neglect" requirement (G2); and it upgrades the app's worst-case breach from "annoying" to "full transaction history exfiltrated" (§5.3) for a personal project with one maintainer. Deferred behind an explicit ADR + threat-model revision — the ADR-018 deferral pattern, with a harder gate.
- **Screen-scraping / storing bank credentials.** Rejected outright: credential custody is a rule we don't break, and it is usually a ToS violation besides.
- **Client-side CSV parsing (parse in the browser, POST rows).** Rejected: moves validation outside the authorization boundary (§5.2, ADR-004) and puts per-bank mapping logic in the bundle. The server parses; the client uploads.
- **Float / `numeric` amounts.** Rejected: money in floats accumulates rounding error; `numeric` avoids that but invites arithmetic in the wrong types. Integer minor units are the standard answer and make the bug unrepresentable.
- **`timestamptz` for `booked_on`.** Rejected: identical to the all-day-event bug ADR-018 designed away — a booking date is a calendar date and must never shift under a timezone conversion.
- **Timestamp+description dedupe without a stored hash** (compare on read). Rejected: O(n²)-ish and non-idempotent under partial re-import. A `UNIQUE` hash column makes double-import a no-op at the database level.
- **Third-party merchant categorisation API.** Rejected: it would ship the most sensitive column of the most sensitive table to a vendor to save a few regex rules. Local rules only.
- **Merging finance and stocks into one "money" widget** (ADR-021 in progress). Rejected: they have different data (my balances vs public prices), different privacy tiers (highest-value vs public market data), and different failure modes (stale import vs stale quote). Two widgets, one clean boundary, and the composition (portfolio) is explicit when it arrives.
- **Pie chart for the category breakdown.** Rejected: pies are hard to compare, lean on color as the primary encoding, and are the worst chart type for the hidden-table/`role="img"` pattern. A sorted horizontal bar list carries the same information accessibly.
