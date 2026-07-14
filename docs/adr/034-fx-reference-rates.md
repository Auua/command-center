# ADR-034: FX from central-bank reference rates (Frankfurter), not from the metered quote provider

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

Two ADRs need an exchange rate, for different reasons, and both are currently pointed at the wrong thing:

- **ADR-021 (stocks/FX watchlist)** put FX pairs — EUR/JPY, "because of the Japan habit" — and equities
  behind a single `MarketDataProvider` port backed by **Twelve Data's free tier**, worker-polled every 5
  minutes while a market is open, plus one daily-series call per symbol for the sparkline. The ADR is
  explicit that the free-tier credit budget is the binding constraint on the whole widget and that the
  ≤ 20-symbol cap and the polling intervals are therefore _architecture_.
- **ADR-030 (finance)** stores balances and transactions as **integer cents** on `date`-typed booking days,
  and will hold more than one currency the moment a Japan trip or a JPY account exists. Converting to a
  home currency needs a rate — and specifically a rate **for the booking day**, not for now.

The thing neither ADR noticed is that **these two use cases want the same data, and it is not a quote.**
A watchlist row Anna glances at once a day and an accounting conversion of a transaction that settled on
13 July both want a **daily reference rate from an authoritative source**. Neither wants a tick. Yet FX is
currently spending the scarce, metered resource (Twelve Data credits) that the equities half genuinely
needs, in order to deliver intraday precision that nothing in the product consumes.

Forces: NFR-8 (the free-tier budget is the constraint), §5.2 (keys server-side), ADR-021's honesty rule
(`asOf` ≠ `fetchedAt`; a delayed price rendered as live is a lie), §4.1 (module boundaries — finance must
not import markets), and provenance: **for money, where the number came from is part of the number.**

## Decision

### Provider choice

**Frankfurter** — `https://frankfurter.dev`, API at `https://api.frankfurter.dev/v1/…` — becomes the FX
source for both use cases.

| Property         | Value                                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth             | **none** — no key, no account                                                                                                                                                    |
| Free-tier limits | **no quotas.** "There are no quotas. Requests are rate-limited to prevent abuse, but there are no monthly or daily caps." Responses carry `Cache-Control: public, max-age=86400` |
| Data             | central-bank reference rates (ECB + ~80 others), 201 currencies incl. EUR and JPY, history back decades                                                                          |
| Licence / terms  | open source, self-hostable (Docker); **free for commercial use** — no non-commercial clause                                                                                      |
| Attribution      | credit the source (ECB via Frankfurter) — rendered in the card's source line and the about panel                                                                                 |

Verified live on 2026-07-14: `GET /v1/latest?base=EUR&symbols=JPY,USD,SEK` → `200`, and
`GET /v1/2026-07-01..2026-07-14?base=EUR&symbols=JPY` returns the full series in **one call**.

**The limitation, stated first because it is the decision.** ECB reference rates are published **once per
TARGET business day**, around 16:00 CET. Verified: on Tuesday 14 July, `latest` returned
`"date": "2026-07-13"`; the timeseries call over 1–14 July returned **nine** points, skipping weekends.
This is not an intraday quote and never will be.

For **finance**, that is not a limitation — it is precisely correct, and it is what an accountant would use.
For the **watchlist**, it is a genuine trade: EUR/JPY becomes a once-a-day number with a day-over-day change,
not a live tick. We take that trade, and the reasoning is the same one ADR-021 used to refuse price alerts:
a personal dashboard that shows a live-updating currency tick is inviting a checking habit, and Anna is
watching EUR/JPY because she goes to Japan, not because she is running a book.

### Integration shape

Frankfurter replaces Twelve Data **for `kind = 'fx'` rows only**. Twelve Data keeps equities, because no
keyless authoritative equity source exists. This is the first real exercise of the port ADR-021 built for
exactly this purpose — _"swapping providers must be one adapter + a conformance test suite, not a widget
rewrite"_ — and the widget does not change at all.

- **The worker's poll job splits by `kind`** (ADR-005, pg-boss):
  - **Equities:** unchanged — batch quote every 5 min while the exchange is open.
  - **FX:** **one request per day**, after the ECB publication window (~17:00 CET on TARGET business days),
    fetching `latest` for the union of watchlisted quote currencies **in a single call**
    (`?base=EUR&symbols=JPY,USD,SEK,…` — one request covers every pair against EUR).
  - **Sparklines get cheaper, not more expensive:** `/v1/{start}..{end}?base=EUR&symbols=JPY` returns the
    whole series in one request, replacing ADR-021's one-daily-series-call-per-symbol-per-day.
- **Budget effect — the material win.** FX drops **out of the Twelve Data credit budget entirely**.
  ADR-021's ~100–120 batch calls per weekday now serve equities alone, and the per-symbol series calls
  collapse to zero for FX. NFR-8 gets meaningfully safer and the ≤ 20-symbol cap stops being the load-bearing
  wall it was, because the metered provider is now carrying strictly less.
- **Reads still never touch a provider.** FX rows land in the same `market_quotes` cache with
  `source = 'frankfurter'`; `GET /markets/watchlist` is unchanged, still a single Postgres read (NFR-2).
- **Finance (ADR-030) does not import `MarketsModule`** (§4.1 bans it). It uses the composition point ADR-021
  already anticipated — _"finance owns holdings, calls MarketsModule's quote read through the API layer"_.
  Conversion happens **at write time, on the server, for the booking date**: `POST /finance/transactions`
  with a foreign-currency amount causes the server to resolve the ECB rate **for that booking day**
  (`/v1/2026-07-13?base=EUR&symbols=JPY`) and **store it on the transaction, immutably**. Rates are never
  recomputed at read time, for two reasons: a balance that changes when you reload it is a bug, and a
  historical transaction converted at today's rate is simply the wrong number.

### Data model

No new table. Two small additions:

**`market_quotes`** (ADR-021) gains one column:

```sql
alter table market_quotes
  add column as_of_granularity text not null default 'intraday'
    check (as_of_granularity in ('intraday','daily'));
```

ADR-021 made `as_of` (what the price _means_) and `fetched_at` (what staleness means) separate columns
because "a delayed price rendered as live is a lie". `as_of_granularity` is the third leg of that stool: an
ECB reference rate fetched four seconds ago is **fresh, and a day old, and neither of those facts is
inferable from a timestamp**. Storing the granularity means the UI can say "ECB reference rate · 13 July"
rather than "delayed 15 min", **mechanically** — the honesty rule stops depending on someone remembering to
branch on `source`.

**`finance_transactions`** (ADR-030) gains, for the foreign-currency case:

```sql
  fx_rate      numeric(18,8),   -- ECB reference rate used, e.g. 185.23000000
  fx_rate_date date,            -- the reference date it came from (a business day)
  fx_source    text             -- 'ecb-via-frankfurter'
```

Nullable, and set only when the transaction currency differs from the account currency. Integer cents
(ADR-030) are stored in **both** currencies — original and converted — because a conversion is a fact that
happened once, not a view.

### API contract

**No new public endpoint.** This is deliberate and is the shape ADR-021 already implies:

- `GET /markets/watchlist` is unchanged. FX rows simply carry `asOfGranularity: 'daily'`, and `marketOpen`
  is returned as **`null`** rather than `false` for them — an ECB reference rate is not "closed", it is a
  different kind of thing, and `false` would render a misleading "market closed" chip.
- `POST /finance/transactions` accepts `{ amountMinor, currency, bookedOn, … }` and resolves the rate
  **server-side**. There is deliberately **no client-supplied `fxRate` field**: a client-supplied exchange
  rate is a client-supplied balance, and §5.2's reject-unknown-fields would drop it anyway — this makes the
  omission intentional rather than incidental.
- The Frankfurter adapter is internal to `MarketsModule` and reachable only through the port. Finance does
  not call it; it asks the API layer for a rate on a date and gets a number with a provenance.

### Failure & rate-limit posture

- **No key** → nothing to leak (§5.2), nothing to exhaust, no per-user provider secret, no rotation.
- **One request per day** makes backoff trivial: retry hourly until the day's rate lands (the ECB does
  occasionally publish late), give up at midnight, keep yesterday's rate with `stale: true`. There is no
  scenario in which we hammer this provider.
- **Weekends and TARGET holidays have no rate at all.** The correct behaviour is to serve the most recent
  business day's rate with its true `as_of` — which the model already does, because `as_of` was always the
  provider's date and never ours. The card reads "ECB reference rate · Friday 10 July", which is honest and
  is also what every bank does.
- **If Frankfurter dies permanently**, the escape is unusually good: the ECB publishes the same reference
  rates itself as a free XML feed, and Frankfurter is open source and Dockerised, so self-hosting is a
  fallback rather than a fantasy. This is the strongest availability story of any external provider in the
  codebase, and it is a large part of why it wins.

### Licensing & attribution

Frankfurter is open source and free for commercial use; the ECB publishes its euro reference rates for free
re-use with attribution. We render **"Rates: European Central Bank via Frankfurter"** in the card's source
line (next to ADR-021's mandatory "not investment advice" footer) and in the about panel.

Worth stating plainly, because ADR-022 had to concede the opposite: **this provider imposes no
non-commercial restriction**, so unlike the weather widget, the FX path forecloses nothing about a future
productization.

## Consequences

- **Easier / the point:** the metered provider now serves only what genuinely needs metering. Twelve Data's
  free-tier budget — which ADR-021 correctly identified as the constraint the whole widget is built around —
  stops being spent on currency pairs, and the sparkline call pattern gets cheaper at the same time.
- **Easier:** FX gains a keyless, quota-free, self-hostable, authoritative source with decades of history.
  For the money-adjacent half of the dashboard, **provenance is a feature**: "the ECB said 185.23 on 13 July"
  is a defensible number in a way that "a free quote API said 185.2317 at some point" is not.
- **Easier:** ADR-030's multi-currency story stops being an open question. Booking-day conversion, stored
  immutably on the transaction, is both the correct accounting and the cheapest implementation.
- **Harder / committed to:** **EUR/JPY on the watchlist is a daily number.** If Anna wants an intraday
  currency tick, that is a deliberate re-opening of this ADR (and of NFR-8), and it means putting FX back on
  Twelve Data's credit budget. The trade is stated here so that it is a choice, not a regression.
- **Committed to:** `as_of_granularity` in the model and in the UI — "ECB reference rate · 13 July" is not
  the same claim as "delayed 15 min", and the widget must not blur them. `marketOpen: null` for FX.
- **Committed to:** rates are resolved server-side and stored on the transaction; there is no client-supplied
  rate, and historical conversions never drift.
- **Open questions for Anna:** (1) Confirm the daily-granularity trade for the watchlist — this is the one
  user-visible thing this ADR changes. (2) Should the FX sparkline be 7 business days (matching equities) or
  30 (FX moves slowly, and 7 ECB points is a very short line)? (3) ADR-021 asked whether hedge adapters
  should be written up front; this ADR removes half the exposure — is the remaining Twelve Data dependency
  (equities only) now small enough to leave un-hedged?

## Alternatives considered

- **Keep FX on Twelve Data (the status quo of ADR-021).** Rejected: it spends a metered, quota-capped,
  terms-can-change-tomorrow resource to deliver intraday precision that no part of the product consumes,
  while making the widget's viability depend more heavily on a single free tier. It survives for equities
  only because there is no keyless authoritative equity source — which is the honest asymmetry.
- **exchangerate.host.** Listed in `public-apis` as no-auth, and rejected: it has since moved to an
  account/API-key model with paid tiers (it now has signup and pricing pages). That makes it a secret to
  custody (§5.2) and a quota to watch, in exchange for data whose provenance is less clear than the ECB's.
  Its presence in the public-apis list is itself the lesson: **the list records what an API was, not what it
  is** — every entry has to be re-verified against the live terms, which is why every provider in this batch
  was called before it was proposed.
- **`fawazahmed0/currency-api`** (public-apis: "150+ currencies, no rate limits"). Rejected: it is a JSON
  dump served off a CDN with no stated provenance for its rates and no institution behind it. For a widget
  that renders **money**, "a file on a CDN says EUR/JPY is 185" is not a source — and it would sit underneath
  ADR-030's account balances, which is the one place in this dashboard where being quietly wrong is worst.
- **Fixer / Open Exchange Rates / CurrencyLayer.** Rejected: key-gated, metered free tiers (~100–1 000
  calls/month), and most of them **pin the base currency to USD on the free plan** — an absurd constraint for
  a euro-denominated dashboard, and one that would force us to do our own cross-rate arithmetic and thereby
  invent rounding errors the ECB has already avoided.
- **Intraday FX as a requirement** (rather than as a provider question). Rejected on product grounds, not
  technical ones: it is the same argument ADR-021 used to refuse price alerts and ADR-014 used to refuse
  "streak at risk" nudges — a personal dashboard should not manufacture reasons to keep looking at it.
- **Client-direct Frankfurter calls.** It is keyless and CORS-enabled, so it is the ADR-022 temptation
  exactly. Rejected for ADR-022's reasons verbatim: it defeats the shared cache, puts a third-party round
  trip in the widget's critical path, hands Anna's IP to a provider on every dashboard load (NFR-7), and
  carves an exception into ADR-004 in the one place where the exception is easy — which is how a
  single-authorization-point architecture rots.
- **Deriving EUR/JPY from two USD-based quotes.** Rejected: it invents a cross-rate with our own rounding on
  top of someone else's, when a first-party EUR-based reference rate is available for free.
- **Self-hosting Frankfurter now.** Rejected for v1 (a container is ops, G2), but recorded as the escape
  hatch — its existence is a large part of why the hosted service is safe to depend on.
