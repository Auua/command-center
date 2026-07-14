# ADR-035: Transit departures widget (HSL / Digitransit)

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

This is the one genuinely **new widget** that the public-API sweep turned up, and it earns its place on a
different axis from everything else in the dashboard: it is the only card whose value decays in **seconds**.

Every other widget answers a question that is true all day — what are my tasks, what is the word of the day,
how did I feel this week. A departures board answers "should I put my shoes on **now**", and on a personal
dashboard in Helsinki that is plausibly the single most-looked-at number of the morning. It sits in the same
quadrant as the weather card (ADR-022): ambient, glanceable, home-shaped, not something Anna authors.

Forces, and they cut against the established patterns in interesting ways:

- **Real-time data cannot be meaningfully cached.** ADR-021 built its entire design around the principle that
  provider traffic must scale with the _symbol set and the clock_, not with page loads — because Twelve Data
  meters us. That principle cannot survive contact with a departures board: a 5-minute-old departure time is
  not stale, it is **wrong**, and a wrong departure time makes you miss a bus. So this widget must be the
  documented exception, and the ADR has to justify why the exception is safe here and not there.
- **A transit query is a location disclosure.** A home stop plus a time-of-day access pattern is a decent
  proxy for where Anna lives and when she leaves the house — §5.3-adjacent. ADR-022 already established the
  answer to this exact shape of problem (the API proxies; the provider sees our backend, never Anna's browser),
  and it applies here with more force, not less.
- **Digitransit is public-sector infrastructure, not a startup's free tier.** That changes the risk calculus
  in a way NFR-8 cares about: the failure mode of a free tier is "the terms change and the widget dies", and a
  municipal transit authority's open API is about as durable as free APIs get.
- NFR-11 (a departures board is a table, and "the 550 in 3 min" must not be conveyed by colour), NFR-12
  (Finnish stop and route names are content), NFR-2, ARD §2's degrade-don't-die posture.

## Decision

### Provider choice

**Digitransit** — the routing platform behind HSL's own journey planner, operated by HSL/Fintraffic.

| Property         | Value                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint         | GraphQL: `https://api.digitransit.fi/routing/v2/hsl/gtfs/v1`                                                                                                                                                            |
| Auth             | **API key (subscription key), free** — registration at `portal-api.digitransit.fi`. _"Digitransit is not charging any fees on joining and utilizing API."_                                                              |
| Free-tier limits | **no published quota.** Rate/quota limiting has been enforced since 2024-01-31, but the terms state the limits _"should only restrict misuse of the APIs, not normal use"_, and the guidance is to stay under ~10 req/s |
| Licence          | **CC BY 4.0** for Digitransit data; **ODbL** for the OpenStreetMap-derived geographic/routing data                                                                                                                      |
| Attribution      | credit Digitransit as the source **and include the date/time of data retrieval** (e.g. "© Digitransit 2026")                                                                                                            |
| Commercial use   | permitted (CC BY 4.0)                                                                                                                                                                                                   |

Verified on 2026-07-14 against `digitransit.fi/en/developers/apis/1-routing-api/`,
`…/7-terms-of-use/` and `…/api-registration/`.

Two things follow directly from that table:

- **The key is server-side only** (§5.2). It never reaches the browser, which means the widget cannot call
  Digitransit even if someone wanted it to. Same posture as ADR-021's market-data key.
- **The attribution obligation is on-surface**, not in an about panel: the licence asks for the source _and
  the retrieval time_. That is the second provider in this batch (after EDRDG in ADR-032) whose licence
  demands attribution where the data is displayed rather than where it is convenient — and here it is
  actually a **usability win**, because "as of 08:41:12" is exactly what you want to know about a departure
  board anyway. The obligation and the honest UI are the same line of text.

### Integration shape — the documented exception: short-TTL cache, visibility-gated polling

The card must show the truth _now_, so the ADR-021 worker-poll shape is wrong here and the ADR-022
cache-aside shape is right — but with a much shorter TTL and one extra guard.

- **`GET /api/v1/transit/departures?stopId=` is a cache-aside read** against a `transit_departures` cache
  with a **30-second TTL**, keyed by stop. A hit serves Postgres; a miss fetches upstream inline. 30 s is
  chosen because it is short enough that a departure minute is never wrong by more than a rounding, and long
  enough that N devices, N tabs and a reload storm collapse into one upstream call.
- **The client polls only while the tab is visible and focused** (Page Visibility API) — a background tab
  polls **zero** times. This is the guard that makes the exception safe: without it, an open laptop would
  quietly hammer a public service all night for a card nobody is looking at. With the server cache in front,
  every device Anna owns shares one upstream call per 30 s while she is actually looking.
- **Stale-while-revalidate on top:** a slow upstream never blanks the card; the previous departures stay with
  their retrieval time visible.
- **Why this is allowed to differ from ADR-021.** Three reasons, and all three must hold for any future widget
  claiming the same exception: (1) the provider does **not** meter us with a hard daily credit budget;
  (2) the data's useful life is shorter than any tolerable cache TTL, so worker-polling would produce a card
  that is confidently wrong rather than honestly stale; (3) the traffic is bounded by the visibility gate and
  the shared cache, so it scales with _Anna actually looking_ — which is a bounded quantity, unlike page loads
  in a world of background tabs. Written down as a test, because "real-time so we poll on read" is exactly the
  reasoning that would wreck the markets widget if it were copied there without the first condition.
- **No worker job, no events, no automations.** A "leave now" push notification is explicitly **not** in v1 —
  it would need a per-minute evaluator against a 30-second cache and a notification budget, and the ARD's
  60-second automation SLO (NFR-3) is not good enough to tell someone to run for a bus. A dashboard that is
  wrong about a bus is worse than a dashboard that is silent about one.

### Data model

Postgres `transit_departures` — **shared, not user-scoped**: the fourth instance of the documented
public-cached-data exception (ADR-013's curriculum, ADR-021's `market_quotes`, ADR-022's `weather_cache`,
ADR-033's `public_holidays`). No RLS needed; the client never reads it, only `TransitModule` does.

```sql
create table transit_departures (
  stop_id     text primary key,          -- "HSL:1173434" — provider-native, opaque to us
  stop_name   text not null,             -- as the provider spells it (NFR-12: it's Finnish)
  payload     jsonb not null,            -- normalised [{ routeShortName, mode, headsign,
                                         --   scheduledAt, realtimeAt, isRealtime, cancelled }]
  as_of       timestamptz not null,      -- provider's data timestamp
  fetched_at  timestamptz not null,      -- when WE retrieved it — also the attribution timestamp
  source      text not null default 'digitransit-hsl'
);
```

`as_of` / `fetched_at` are ADR-021's distinction, doing real work again — and here `fetched_at` is doing
**double duty as the licence's required retrieval timestamp**, which is a pleasing collapse of a legal
obligation and a correctness one into a single column.

The cache **holds no user identifier at all** — it is keyed by stop, and a stop serves thousands of people.
The same "a dump of this table reveals that _someone_ asked about Helsinki, and nothing else" property that
ADR-022 designed for, achieved the same way and for the same reason.

**Which stops Anna watches lives in `widget_layouts.settings`** (`settingsSchema`:
`{ stops: { id, name }[] (≤ 3), modes: ('BUS'|'TRAM'|'SUBWAY'|'RAIL'|'FERRY')[], rowCount: 3–8 (default 5),
walkMinutes: 0–20 (default 0) }`) — presentation config, the ADR-022 precedent, not the ADR-021 one: there is
no per-stop user state (no favourites, no ordering that outlives the setting) worth a table. `walkMinutes`
shifts the highlight threshold ("leave in 2 min"), which is the single most useful thing this card can do and
costs nothing.

### API contract

Under `/api/v1/transit`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007),
reject-unknown-fields on:

- `GET /departures?stopId=&limit=` →
  `{ stop: { id, name }, departures: [{ routeShortName, mode, headsign, scheduledAt, realtimeAt, isRealtime,
cancelled, minutesUntil }], asOf, fetchedAt, stale: boolean, attribution }`.
  `minutesUntil` is **computed server-side** from `realtimeAt ?? scheduledAt` — the client does not do
  clock arithmetic against a possibly-skewed device clock to decide whether Anna can catch a bus.
- `GET /stops/search?q=` → `{ results: [{ id, name, code, mode, zone }] }` — used only while typing in the
  settings panel, cached 30 days per query (stops do not move), throttled hard.
- No writes. The module owns no user data.

Errors: a cold cache with a dead upstream is a typed `503` (`{ error: 'upstream_unavailable' }`) so the card
can say "Couldn't reach HSL" rather than crashing; a warm cache **never** errors — it serves the last
departures with `stale: true` and its `fetchedAt`, and the UI is required to show that timestamp.

### Failure & rate-limit posture

- Key in the backend env only (§5.2). Provider errors are logged with the source id and **never surfaced
  verbatim** (they can carry the key) — ADR-021's rule.
- Server-side throttle: at most **one upstream call per stop per 30 s**, globally, regardless of how many
  clients ask. Plus `@nestjs/throttler` per-user on the endpoint. Together these make it structurally
  impossible for the frontend to exceed a fixed upstream rate, which is what lets us honour Digitransit's
  "don't misuse it" terms with a guarantee rather than an intention.
- A stale card is honest and useful ("as of 4 min ago"); a **confidently wrong** card is neither. When
  `stale` is true the card **stops rendering `minutesUntil` as a countdown** and shows the absolute scheduled
  time instead — because "3 min" that is four minutes old is a lie that makes you miss a bus, whereas "08:44"
  is still true.

### Accessibility

- The departures list is a `<table>` with real headers (Route / Destination / Departs) — it is tabular data,
  and screen readers get row/column context for free (ADR-021's rule).
- **No colour-only encoding.** Real-time vs scheduled is text ("live" / "scheduled"), not a green dot;
  cancellation is the word "Cancelled" plus a strikethrough, never red alone. Mode is a text label with an
  `aria-hidden` icon, never an icon alone (ADR-022's rule).
- Times use `<time datetime>` and `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat`; the row's accessible name
  reads "550 to Itäkeskus, departs in 3 minutes, 08:44, live".
- The countdown is **not** an `aria-live` region — announcing every tick is ADR-028's rejected antipattern.
  Updates land silently; the user reads them.
- Stop names and headsigns are **content** (Finnish/Swedish) and are never routed through translation
  (ADR-011's rule); chrome copy goes through the message catalog (NFR-12).

### UX states & interaction

- **Loading:** skeleton rows at the final row height, inside the widget's own suspense boundary.
- **Empty (no stop set):** "Pick a stop to see departures" with a direct button into settings — the empty
  state is the affordance (ADR-017's rule). The widget **never** asks for geolocation on mount (ADR-015's
  denial-by-reflex; ADR-022's rule). A "use my location to find nearby stops" button in the _settings panel_
  is the only path that touches `navigator.geolocation`, and what it stores is a **stop id**, not a coordinate.
- **Stale / upstream down:** last departures stay with "as of 08:37 · couldn't refresh"; countdowns degrade to
  absolute times (above).
- **Attribution:** a persistent card footer — **"© Digitransit · data retrieved 08:41"** — satisfying CC BY 4.0
  and being genuinely useful at the same time. Same slot as ADR-021's "not investment advice" line and
  ADR-032's JMdict line; this is now an established piece of card furniture.
- **Privacy:** the provider is called server-to-server and never sees Anna's browser, her IP, or her session
  (ADR-022's argument, reused); the cache holds no user id; the stop id lives in her own widget settings.

## Consequences

- **Easier:** a high-utility ambient card for a free, keyed, public-sector API, on rails that already exist —
  it is one module, one cache table, no worker, no events, no user data.
- **Easier:** the module holds **no user data**, so — like ADR-022's weather — it needs no RLS policy, no
  export endpoint, and no entry in the §5.3 asset inventory.
- **Harder / committed to:** **this is the first widget whose provider traffic scales with looking.** The
  visibility gate and the 30 s shared cache are not optimisations, they are the terms of the exception, and
  removing either re-opens both NFR-8 and our standing with a public service. The three conditions under
  which a widget may claim this exception are written above precisely so that the next one has to argue for it.
- **Harder / committed to:** a second server-side API key to custody (after Twelve Data), and Digitransit's
  quota is _undocumented_ — "don't misuse it" is a social contract rather than a number, which is why the
  server-side per-stop throttle exists.
- **Committed to:** the on-card attribution line **with a retrieval timestamp** (a licence obligation);
  countdowns that degrade to absolute times when stale; no "leave now" push in v1.
- **Scope reality:** this is **Helsinki-region-shaped**. Digitransit covers Finnish regions via other endpoints,
  and the ODbL/CC BY split means the geographic data has a share-alike condition we do not currently trigger
  (we store no OSM-derived geometry — only stop ids, names and times, which are the CC BY 4.0 half). If the
  widget ever renders a map or a route geometry, **ODbL attaches** and that is a new decision.
- **Open questions for Anna:** (1) Is one home stop enough, or do you want a home/work pair (the cap is 3)?
  (2) `walkMinutes` — should the card show "leave in 2 min" (walk-adjusted) as the primary number, which is
  the genuinely useful framing, or the raw departure time? (3) Is a departures board actually something you
  want on the dashboard, or is it something your phone's map app already does better at the moment you need it?
  That is a real question and a "no" here is a perfectly good answer — this is the most speculative ADR in the
  batch.

## Alternatives considered

- **Worker-polled cache (the ADR-021 shape).** Rejected, and the rejection is the core of this ADR: a
  worker polling every stop on a schedule would either be too slow to be correct (a 5-minute-old departure is
  wrong, not stale) or would poll continuously for a card nobody is looking at. The visibility-gated,
  short-TTL, shared cache-aside read is the shape that matches the data's actual half-life.
- **Client-direct calls to Digitransit.** Rejected: the subscription key would ship to the browser (§5.2 —
  and a leaked key on a public API is our name attached to someone else's abuse), it defeats the shared cache
  so every tab is an upstream call, and it hands Anna's IP and morning routine to a third party on every
  dashboard load (NFR-7, ADR-022's argument). ADR-004 forbids it anyway.
- **A "leave now" push notification / automation.** Rejected for v1: NFR-3's 60-second automation SLO is not
  tight enough to be trusted with a bus, it needs a per-minute evaluator against a deliberately coarse cache,
  and a dashboard that tells you to run and is wrong has done real harm. It is also, like ADR-021's price
  alerts and ADR-014's streak nudges, a feature that manufactures urgency.
- **Google Maps / Transit APIs.** Rejected on NFR-8 and NFR-7: billing-account-gated with a credit card on
  file (a hard fail for a €20/mo budget where a bug becomes an invoice), and it hands the query to an
  advertising company. Digitransit is free, public-sector, and CC BY.
- **Storing departures in MongoDB.** Rejected by §4.3: a departures payload is a TTL'd cache entry keyed by a
  stop id, not a document with a lifecycle. Same call ADR-022 made for `weather_cache`.
- **Storing watched stops in a table (the ADR-021 watchlist precedent).** Rejected: there is no per-stop user
  state with its own lifecycle (no favourites, no history, nothing queryable) — it is a location preference,
  which is the ADR-022 precedent (settings JSONB), not the ADR-021 one.
- **Geolocating the nearest stop on load.** Rejected: prompt-on-load is ADR-015's denial-by-reflex, and a
  dashboard is a fixed-context surface — Anna's home stop does not move. It survives as an opt-in button
  inside the settings panel that resolves to a **stop id**, which is a far coarser thing to store than a
  coordinate.
- **Doing nothing** (not building this widget). The honest baseline, and a legitimate outcome of the review:
  every other ADR in this batch improves a widget Anna already decided she wants, whereas this one proposes a
  new one. It is here because the API is genuinely excellent and the widget is genuinely useful every single
  morning — but it is the one item in the sweep that should be dropped if the answer is "my phone already
  does that".
