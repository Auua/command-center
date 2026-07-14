# ADR-021: Stock & FX watchlist widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

A watchlist card: a handful of instruments Anna follows — FX pairs (EUR/JPY, because of the Japan
habit) alongside equities (AAPL) — each with a current price, the day's change, a small sparkline, and
favourites pinned to the top. Read-only. No orders, no holdings, no portfolio value.

Forces:

- **Market data is the first thing this dashboard cannot generate itself.** Every other widget's data
  is authored by Anna (tasks, mood) or ingested curriculum we control. Quotes come from a vendor with a
  rate limit, a licence, and an opinion about what we do with them. That makes the _provider_ decision
  the ADR, and everything else follows.
- **NFR-8 (≤ €20/mo total).** The market-data budget is effectively €0, which rules out every real
  data vendor and lands us on a free tier with a hard daily call quota. A design that fetches per user
  page-load will exhaust it; a design that fetches on a schedule for a known symbol set will not.
- **Keys must never reach the client** (§5.2 secrets): so the browser never talks to the provider —
  the API proxies and caches. This is also what ADR-004 already requires (all domain data via the API).
- **Honesty about staleness.** Free tiers serve delayed data (typically 15 min for equities). A price
  rendered without a timestamp is a lie of omission, and a _stale cached_ price rendered as if live is
  a worse one. `asOf` is part of the data, not decoration.
- **Boundary with ADR-030 (finance dashboard, in progress).** That widget is about Anna's _own money_ —
  accounts, spending, net worth. This one is about _instruments she watches_. They must not merge: see
  Consequences.
- NFR-2 (< 200 ms p95 reads), NFR-11 (no colour-only encoding — and a red/green market widget is the
  canonical violation), NFR-12.

## Decision

### Frontend

`apps/web/widgets/stocks/` (`id: "stocks"`), a standard SDK widget (§4.2):

- `settingsSchema` (zod): `{ symbols: WatchSymbol[] (≤ 20), showSparkline: boolean (default true),
sparklineDays: 7 | 30 (default 7), sortBy: 'favorites' | 'change' | 'alpha' (default 'favorites') }`.
  The symbol _list_ is not settings, though — see Data model: it is a table, because favourites and
  ordering are user data that must survive a settings-schema change. Settings hold presentation only.
- Rows render: instrument name + symbol (text), last price with its currency, absolute + percent change
  with a **sign and a direction word**, `asOf` time, a favourite toggle (`aria-pressed`), and an
  optional sparkline.
- Data through generated hooks (`packages/contracts`) against `/api/v1/markets`; TanStack Query with
  `staleTime` matched to the server cache TTL (60 s) so a dashboard reload doesn't re-ask the API for
  something it just answered. The widget never calls a market-data provider directly — it has no key
  to do so with, by construction.
- Sparklines follow **ADR-009's chart accessibility pattern** verbatim: hand-rolled SVG (no chart
  library — one 30-point polyline does not justify a dependency, NFR-8/NFR-1), `role="img"` with an
  `aria-label` enumerating the series, plus a visually-hidden data table. No hover-only tooltip, ever.

### Backend

A new `MarketsModule` (§4.1) with two responsibilities: the user's watchlist (Postgres, RLS) and a
**cached quote proxy** (provider behind an interface).

- **Provider: Twelve Data free tier as v1**, behind a `MarketDataProvider` port
  (`getQuotes(symbols[])`, `getDailySeries(symbol, days)`, `search(query)`). It is the one free tier
  that covers **both FX pairs and equities through a single symbology** — the actual requirement here —
  with a batch quote endpoint (one request, many symbols) and a daily credit budget large enough for
  the polling design below. The port exists because free tiers change terms without warning: swapping
  providers must be one adapter + a conformance test suite, not a widget rewrite.
- **Budget (the design constraint made explicit).** The worker (ADR-005, pg-boss) polls **one batch
  request for the union of all watchlisted symbols**, every 5 minutes, **only while a relevant market
  is open** (equities: exchange hours; FX: Sun 22:00 – Fri 22:00 UTC), plus one daily-series call per
  symbol once per day after close for the sparkline. For ~15 symbols that is ≈ 100–120 batch calls plus
  15 series calls per weekday — comfortably inside an 800-credit/day tier, and it does not grow with
  page loads, tabs, or refreshes. Off-hours the last close is served from cache with a "market closed"
  label and **zero** provider traffic.
- **Cache is the read path.** API reads _never_ call the provider inline: `GET /markets/quotes` reads
  `market_quotes` (Postgres) and returns whatever is there with its `asOf` and `fetchedAt`. This keeps
  NFR-2 trivially satisfied, makes provider outages invisible-but-honest (stale flag, not an error),
  and makes rate-limit exhaustion impossible from the frontend. Manual "Refresh" enqueues a poll job and
  is throttled to 1/min per user (§5.2).
- **Symbol search** (`GET /markets/search?q=`) is the one pass-through call, cached for 24 h per query
  and throttled hard — it runs only while the user types into the add-symbol field.
- No events emitted, no automations in v1: **price alerts are deliberately out of scope** (they would
  turn a read-only widget into an always-on evaluator with a notification budget, and a personal
  dashboard that pings about price moves is a wellbeing regression — the same reasoning ADR-014 used to
  refuse "streak at risk" nudges).

### Data model

Postgres `watchlist_items` (owner: `MarketsModule`, RLS `user_id = auth.uid()`):

```sql
create table watchlist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id),
  symbol       text not null,                       -- provider-neutral: "AAPL", "EUR/JPY"
  kind         text not null check (kind in ('equity','fx')),
  display_name text not null,                       -- "Apple Inc.", "Euro / Japanese Yen"
  currency     text not null,                       -- quote currency: USD, JPY
  is_favorite  boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, symbol)
);
```

Postgres `market_quotes` — **shared, not user-scoped** (public market data; the documented sibling of
ADR-013's no-`userId` curriculum exception). No RLS policy is needed because the client never reads the
table; only `MarketsModule` does, and the API filters to the caller's watchlist:

```sql
create table market_quotes (
  symbol      text primary key,
  kind        text not null,
  price       numeric(18,6) not null,
  prev_close  numeric(18,6),
  change_abs  numeric(18,6),
  change_pct  numeric(8,4),
  currency    text not null,
  as_of       timestamptz not null,   -- the exchange/provider timestamp: what the price MEANS
  fetched_at  timestamptz not null,   -- when WE got it: what staleness MEANS
  source      text not null,          -- provider id, for auditability across swaps
  series      jsonb                   -- [{d,c}] daily closes for the sparkline, ≤ 30 points
);
```

`as_of` and `fetched_at` are separate columns on purpose: a 15-minute-delayed price fetched 4 seconds
ago is fresh _and_ delayed, and the UI has to be able to say both. Watchlist rows live in Postgres (not
in `widget_layouts.settings`) because favourites and ordering are user data with their own lifecycle —
they must survive a settings-schema migration, and a future "which of my instruments moved most" query
is SQL, not JSONB spelunking.

### API contract

Under `/api/v1/markets`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007),
reject-unknown-fields on:

- `GET /watchlist` → `{ items: (WatchlistItem & Quote)[] }` — the API composes the user's rows with the
  cached quotes in one response (one round trip for the card). Each item carries
  `{ price, changeAbs, changePct, currency, asOf, fetchedAt, stale: boolean, marketOpen: boolean, series? }`.
  `stale` is computed server-side (`fetchedAt` older than 3× the poll interval) — staleness is a
  server-known fact, not a client guess about clocks.
- `POST /watchlist` `{ symbol, kind }` → 201; the server resolves `display_name`/`currency` via the
  provider's search (never trusting client-supplied names) and triggers an immediate first quote fetch.
- `PATCH /watchlist/:id` `{ isFavorite?, sortOrder? }` → 200. `DELETE /watchlist/:id` → 204.
- `GET /markets/search?q=` → `{ results: [{ symbol, kind, name, exchange, currency }] }`.
- `POST /markets/refresh` → 202 (throttled 1/min/user).

Error semantics: 400 for shape violations; 404 for missing/foreign ids (uniform, per house rule);
**a provider outage is never a 5xx** — `GET /watchlist` still returns cached rows with `stale: true`, and
a symbol with no quote yet returns `price: null` with a `pending` state rather than being omitted (a
missing row would read as "deleted"). Provider errors are logged with the provider id and never
surfaced verbatim (they can contain the API key in the URL).

### Accessibility

- **No colour-only encoding — the hard one for this widget.** Direction is carried by a sign (`+`/`−`),
  a direction glyph (`▲`/`▼`, `aria-hidden`), and, crucially, **text**: each row's accessible name reads
  "Apple Inc., 214.60 US dollars, up 0.42 percent, as of 17:32". Green/red is the fourth, decorative
  layer. This survives colour-blindness, greyscale, and forced-colours mode.
- The list is a `<table>` with real headers (Instrument / Price / Change / As of), not a div grid:
  screen readers get row/column context for free, and the data _is_ tabular.
- Sparklines: `role="img"` + `aria-label` ("Apple, last 7 closes: 209.1, 211.4, …") plus a
  visually-hidden data table (ADR-009). Value is encoded by position, never by hue.
- The favourite toggle is a `<button aria-pressed>` labelled "Favourite Apple Inc." — never a bare star
  glyph; state changes announce via a polite live region.
- Numbers are formatted with `Intl.NumberFormat` per locale and currency (NFR-12) — thousands
  separators and decimal commas are not cosmetic in Finland — and `<time datetime>` carries `asOf`.
- Stale and market-closed states are text chips ("Delayed 15 min", "Market closed · last close Fri
  22:00"), never a greyed-out row (grey is not a message).

### UX states & interaction

- **Loading:** skeleton rows matching the final row height (no layout shift) inside the widget's
  suspense boundary.
- **Empty:** "No instruments yet — add EUR/JPY or a ticker." with the search field focused-on-action;
  the empty state is the affordance.
- **Pending quote:** a newly added symbol shows "Fetching…" with the name resolved, not a zero price. A
  zero or blank price that later becomes real is how people misread a screen.
- **Stale / offline:** the card keeps rendering the last known prices with a visible "Delayed data ·
  updated 34 min ago" line and a Retry. It never shows a spinner over old prices as if they were live,
  and never blanks them (a blank card is worse than an honestly-labelled old one).
- **Error:** provider hard-down still yields cached rows; only an API/DB failure reaches the SDK
  fallback card.
- **Remove:** optimistic with the shared ~6 s Undo (ADR-008), timeout paused on focus/hover.
- **"Not investment advice."** A permanent, visible footer line on the card: _"Delayed market data ·
  informational only, not investment advice."_ Not buried in an about panel — the disclaimer belongs
  where the numbers are, because that is where a decision would be made. The provider's attribution
  requirement is satisfied in the widget's about panel (and reviewed per-provider before switching).
- All chrome copy through the message catalog (NFR-12).

## Consequences

- **Easier:** a whole class of failure (rate-limit exhaustion, key leakage, per-page-load fan-out) is
  structurally impossible — the frontend cannot reach the provider, and provider traffic is a function
  of the symbol set and the clock, not of user behaviour.
- **Easier:** provider swap = one adapter behind `MarketDataProvider` + its conformance tests. Given
  free-tier volatility, this is the single most valuable thing in the ADR.
- **Harder / committed to:** we own a polling budget. Adding a 50-symbol watchlist, a 1-minute refresh,
  or intraday sparklines would blow the free tier — so the cap (≤ 20 symbols) and the intervals are
  _architecture_, and any change to them re-opens NFR-8.
- **Committed to:** `as_of` ≠ `fetched_at` in the model and in the UI; delayed-data labelling; no price
  alerts in v1; no colour-only direction.
- **Boundary with ADR-030 (finance dashboard, in progress):** this widget stores **no quantities, no
  cost basis, no P&L** — the moment a row grows a "shares held" column it has become a portfolio, which
  is Anna's own financial data (a §5.3-class asset with a very different privacy posture) and belongs to
  the finance module. If a portfolio view is ever wanted, it composes: finance owns holdings, calls
  `MarketsModule`'s quote read through the API layer, and this widget stays a watchlist.
- **Open questions for Anna:** (1) Twelve Data's free tier forbids some redistribution and can change —
  do we want the Finnhub/Alpha Vantage adapters written up-front as a hedge, or written the day we need
  them? (2) Is a 7-day daily sparkline enough, or is intraday wanted (it is a per-symbol call per
  interval — a materially different budget)? (3) Should FX pairs be a separate widget instance from
  equities (per-instance settings would allow it), or is one mixed list actually the point?

## Alternatives considered

- **Call the market API directly from the browser.** Rejected on two independent grounds: the API key
  would ship to the client (§5.2 — and a leaked key is a rate-limit DoS on ourselves), and per-page-load
  fetching multiplies provider calls by tabs and reloads, which is precisely what the free tier cannot
  absorb (NFR-8). ADR-004 already forbids it.
- **Fetch on API read (cache-aside, no worker).** Simpler, and rejected: the first read after a TTL
  expiry pays the provider latency inside a user request (NFR-2), a burst of widgets can stampede the
  provider, and the call rate still scales with user behaviour rather than with the symbol set.
- **Scraping Yahoo Finance / an unofficial endpoint.** Free and comprehensive; rejected on ToS grounds
  (the same principled line R2 draws for AnkiWeb) and on fragility — an unversioned endpoint that breaks
  silently is a bad foundation for a widget whose whole job is being trustworthy about numbers.
- **A paid data plan (~€20–50/mo).** Rejected: it alone would exceed the entire NFR-8 infra budget for a
  glanceable card.
- **Storing the watchlist in `widget_layouts.settings` (JSONB).** Tempting — the SDK gives per-instance
  settings for free. Rejected: favourites/order are user _data_, not presentation; they'd be lost or
  awkwardly migrated on a settings-schema change, they can't be queried, and they'd be invisible to the
  NFR-7 export.
- **Quotes in MongoDB.** Rejected by §4.3: a quote is a fixed-shape numeric row, keyed by symbol,
  updated in place and read with filters — the Postgres column of the split. Nothing document-shaped.
- **Price alerts in v1** (automation on threshold crossing) — rejected: it needs a per-tick evaluator
  against a cache we deliberately keep coarse (5 min), it invites intraday polling (budget), and a
  dashboard that interrupts you about a 2 % move is optimising for anxiety, not for life management.
- **Per-user provider keys (bring your own key).** Rejected for a single-user app: it moves a secret
  into user data for no benefit at this scale, though it is the obvious escape hatch if this ever goes
  multi-user.
