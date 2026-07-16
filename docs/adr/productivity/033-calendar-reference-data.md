# ADR-033: Public holidays in the calendar (and why name days are seeded, not called)

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending product-owner approval

## Context

ADR-018 built the calendar widget as own-events CRUD with server-expanded RRULE, and **deferred external
calendar sync** — Google/CalDAV — on the grounds that OAuth token custody is an ops and security cost out
of proportion to the feature (G2, NFR-8, §5.2). That deferral was right. It also left the calendar with a
gap that has nothing to do with sync:

**A calendar that doesn't know about public holidays is wrong in a way you notice on the first day you
use it.** Planning happens around vappu and juhannus; the Japanese half of this dashboard cares about Golden
Week and 天皇誕生日. Neither is the user's event, neither is a task, and neither should be typed in by hand
every year.

Forces:

- **Holidays are reference data, not user data.** The moment a holiday becomes a `calendar_events` row it
  becomes editable, deletable, duplicable on re-import, and part of the user's NFR-7 export — four bugs from
  one modelling mistake. ADR-021 and ADR-022 already established the shape for public, non-user-scoped
  cached data (`market_quotes`, `weather_cache`); this is a third instance and should look like them.
- **This is the cheapest possible third-party integration**, and that shapes the design: a country-year is
  ~15 rows and effectively never changes. Any design that fetches more than a couple of times a month is
  over-engineered.
- **NFR-12.** In Finland the holiday is called _Vappu_. Rendering "May Day" on a Finnish dashboard is a
  small daily papercut, so a source that carries local names is not a nice-to-have.
- ADR-018's `date`-typed all-day rule (its CHECK constraint makes the timezone-shifted-date bug
  unrepresentable) applies here with full force: a holiday is a calendar day, not an instant.

## Decision

### Provider choice

**Nager.Date** — `https://date.nager.at`, API `v3` (`GET /api/v3/PublicHolidays/{year}/{countryCode}`).

| Property         | Value                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Auth             | **none** — no key, no account, no signup                                                                  |
| Free-tier limits | no published quota; the API itself replies `Cache-Control: public, max-age=604800` — it asks to be cached |
| Coverage         | **166 countries** — FI and JP both present                                                                |
| Local names      | yes — `localName` (`Vappu`, `Uudenvuodenpäivä`, `元日`, `成人の日`) alongside `name`                      |
| Licence          | project is **MIT**; the underlying facts (holiday dates) are not copyrightable                            |
| Commercial use   | **unrestricted** — no non-commercial clause                                                               |

Verified on 2026-07-14 by calling the live API: `/api/v3/AvailableCountries` returns 166 entries including
`{FI, Finland}` and `{JP, Japan}`; `/api/v3/PublicHolidays/2026/FI` returns 15 holidays with correct Finnish
`localName`s; `/api/v3/PublicHolidays/2026/JP` returns 16 with Japanese ones; the response carries a 7-day
`Cache-Control`. Project licence checked at `github.com/nager/Nager.Date`.

One caveat recorded so nobody trips on it later: Nager's **offline** distributions (the Docker container
and the NuGet package) require a sponsor licence key. We use the **free public HTTP API**, which does not.
If we ever want to self-host it, that is a sponsorship, not a free lunch — but we would seed a table
instead (see below), so we won't.

Unlike ADR-022's Open-Meteo, this provider imposes **no non-commercial restriction**, so it forecloses
nothing.

### Integration shape — worker-prefetched annual cache

The gentlest integration in the codebase, and deliberately so:

- **A worker job (ADR-005, pg-boss)** fetches **one country-year per request** and upserts it. It runs
  **monthly**, plus **on demand** when a user's calendar settings reference a country-year we do not hold
  (enqueued, never fetched inline).
- Steady state is therefore roughly **two upstream requests per month** — the design goal being that this
  integration is invisible in every dimension: cost, ops, latency, and the provider's logs.
- **Reads never touch the provider** (ADR-021's rule, ADR-022's rule): `GET /calendar/holidays` reads
  Postgres and nothing else. A Nager.Date outage is not observable from the dashboard, ever.
- Not cache-aside (ADR-022's shape): that shape exists because weather's coordinate space is unbounded and
  the data expires hourly. Holidays are a tiny, enumerable, effectively-immutable set — the opposite
  situation, and it gets the opposite integration.

### Data model

Postgres `public_holidays` — **shared, not user-scoped**: the documented sibling of ADR-013's
no-`userId` curriculum, ADR-021's `market_quotes` and ADR-022's `weather_cache`. No RLS policy is needed
because the client never reads the table; only `CalendarModule` does.

```sql
create table public_holidays (
  country_code char(2) not null,
  year         int  not null,
  date         date not null,            -- date, NOT timestamptz — ADR-018's all-day rule
  local_name   text not null,            -- "Vappu"        (what we render, NFR-12)
  english_name text not null,            -- "May Day"      (what we search/label in EN)
  is_global    boolean not null,         -- nationwide vs regional (Nager's `global`)
  counties     text[],                   -- subdivision codes when not global
  types        text[] not null,          -- Nager's `types`: Public | Bank | School | Optional
  source       text not null default 'nager.date',
  fetched_at   timestamptz not null,
  primary key (country_code, year, date, english_name)
);
```

`date` rather than `timestamptz` is the whole point: a holiday has no instant, and ADR-018 already
demonstrated that storing an all-day thing as a timestamp is how you ship a calendar that shows Christmas
on the 24th for anyone east of London. The PK includes `english_name` because two distinct holidays can
land on the same date in some countries, and the composite key makes the upsert idempotent.

**Which countries the user sees is settings, not data**: the calendar widget's `settingsSchema` gains
`holidayCountries: string[] (≤ 3, default ['FI'])` and `showRegionalHolidays: boolean (default false)`.
This is presentation config in `widget_layouts.settings` — the ADR-022 precedent (a location) rather than
the ADR-021 precedent (a watchlist), because there is no per-holiday user state to preserve. If holidays
ever grow user state ("I actually work on Epiphany"), that state is a table and this call gets revisited.

### API contract

Holidays are served **on their own endpoint, not merged into `GET /calendar/events`**:

- `GET /api/v1/calendar/holidays?from=&to=&countries=` →
  `{ items: [{ date, localName, englishName, countryCode, isGlobal, types }], pending: boolean }`
- Nothing else. No POST, no PATCH, no DELETE — **there is no way for a client to address a holiday**, so
  the class of bug where a user deletes Christmas does not exist. That is the reason for the separate
  endpoint, and it is worth more than the round trip it costs.
- The widget composes the two layers **client-side** — the same frontend-composition call ADR-011 made for
  the streak pill, for the same reason (no cross-concern coupling in the read model) — and renders holidays
  as a day chip, not as an event block. They look different because they _are_ different.
- `pending: true` (with `items: []`) when a requested country-year has not been fetched yet; the request
  enqueues the fetch. **Never a 5xx, never an inline upstream call inside a user read** (NFR-2).

### Failure & rate-limit posture

No key, so nothing to leak (§5.2) and nothing to exhaust. The worker job: 10 s timeout, 3 retries with
exponential backoff, idempotency key `country|year`, at most one fetch per country-year per day. If
Nager.Date vanished permanently tomorrow, every year we have already fetched keeps working forever and the
fallback is a seed file — we are structurally never more than one `INSERT` away from not needing them,
which is the right amount of dependence to have on a free service.

### Licensing & attribution

The dates of public holidays are facts and are not copyrightable; the Nager.Date _project_ is MIT. Nothing
is legally owed. We credit it in the calendar widget's about panel anyway, per the house rule ADR-011
established (and because a free service that saved us a week deserves a line).

### Name days: seeded, not called — and the rule that generalises

Finnish calendars print **nimipäivät**, and a Finnish personal dashboard that omits them is missing
something the user would notice. There is a live free API for it: `nameday.abalin.net`
(`GET /api/V2/today?country=fi` — verified working on 2026-07-14, returns `"fi": "Aliisa"` for 14 July,
which is correct; no auth).

**We reject it as a runtime dependency and seed a table instead.**

The Finnish almanac is **365 rows**, is published by the University of Helsinki, and is revised roughly
**once every five years**. Taking on a network call, a JSON parse, a cache table, a TTL, a failure mode, a
retry policy and an unversioned third-party dependency — in order to obtain 365 rows of static data that
change twice a decade — is not a trade, it is a mistake with extra steps. (The same API's V1 endpoints
already return 404 — also verified — which is a tidy demonstration of the fragility being avoided.)

The general rule, worth stating because it will come up again:

> **If the entire dataset is smaller than the code needed to fetch it, ingest it — don't call it.**

Name days therefore ship as a `name_days` seed table (`month, day, names text[], locale, source`) or they
don't ship; they are never an integration. The same test is what makes Nager.Date the _right_ call and
`nameday.abalin.net` the wrong one: a holiday set spans 166 countries × N years and needs Easter computed
correctly, so it is worth fetching; a nameday almanac is a CSV.

## Consequences

- **Easier:** ADR-018's deferred external-calendar sync gets most of its felt value for none of its cost —
  no OAuth, no token custody, no refresh dance, no §5.2 secret, no consent screen. The part of "calendar
  integration" that is genuinely useful daily turns out to be the part with no privacy dimension at all.
- **Easier:** the integration is ~2 requests/month and one table. There is no realistic future in which this
  costs money, breaks under load, or needs monitoring.
- **Committed to:** holidays are **reference data, not events** — a separate table, a separate endpoint, no
  write surface, `date`-typed, composed on the client. If a future feature wants "the user's own day off" that is
  a user-owned `calendar_events` row, and it is a different thing wearing similar clothes.
- **Committed to:** local names are rendered (`Vappu`, not "May Day") — NFR-12 with teeth.
- **Harder:** regional holidays (`isGlobal: false`) are real and vary by subdivision; v1 hides them behind a
  setting and defaults to national ones only, because getting Finnish regional holidays subtly wrong is worse
  than not showing them.
- **Open questions for the product owner:** (1) Should holidays feed **automations** — "don't fire work reminders on a
  public holiday"? That is a cross-module read and belongs behind the event bus rather than an import (§4.1),
  and it is a bigger feature than it looks — the same shape as ADR-022's "should weather adjust the calendar"
  question, and probably the same answer: later, deliberately. (2) Name days: worth the 365-row seed, or is
  it clutter on a card that is mostly about tasks? (3) Do you want JP holidays on the calendar at all, or is
  Golden Week better as a fact the Japanese widgets know about?

## Alternatives considered

- **Google Calendar's holiday calendars via OAuth.** Rejected: it is exactly the token-custody cost ADR-018
  deliberately deferred — and it would be paid for **data that has no privacy dimension whatsoever**. Buying
  a public-domain fact with an OAuth grant to the user's entire calendar is the worst trade in this document.
- **Subscribing to a public ICS holiday feed.** Rejected: unversioned, unlicensed, published by whoever, and
  a user-supplied-URL fetch means inheriting ADR-020's whole SSRF-hardening apparatus (private-IP rejection,
  redirect limits, body caps) for a use case that a typed JSON endpoint solves without any of it.
- **Calendarific / Abstract API / HolidayAPI.** Rejected: all require an API key and meter a free tier
  (typically ~1 000 calls/mo, and some restrict the free tier to the _current_ year only). A secret to custody
  (§5.2) and a quota to watch, in exchange for facts that are in the public domain and available keylessly.
  Nager.Date is strictly better on every axis that matters here.
- **Hardcoding the Finnish holidays.** Tempting — it is fifteen dates. Rejected: Easter is **computed**
  (Pitkäperjantai, Pääsiäispäivä, Toinen pääsiäispäivä, Helatorstai and Helluntai all move with it), Juhannus
  and Pyhäinpäivä float to specific weekends, and hand-rolling the computus is a famous way to be quietly
  wrong in 2031. It also gives us nothing for Japan.
- **Storing holidays as `calendar_events` rows for the user.** The lazy path, and the one that costs the most
  later: they duplicate on every re-import, they become editable and deletable, they pollute the NFR-7 export
  with data that isn't the user's, and they make "delete all my events" delete Christmas. The separate table with
  no write surface makes all of that unrepresentable rather than merely discouraged.
- **A `nameday.abalin.net` runtime integration.** Rejected — see above. The dataset is smaller than the
  client that would fetch it.
- **Cache-aside on read (the ADR-022 shape).** Rejected: that shape earns its keep when the key space is
  unbounded and the data expires. Holidays are a tiny enumerable set that changes never; prefetching them is
  simpler, and it keeps the provider off the read path entirely.
