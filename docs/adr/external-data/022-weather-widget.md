# ADR-022: Weather forecast widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending product-owner approval

## Context

A weather card: current conditions plus a multi-day forecast for a home location (Helsinki), glanceable
next to the calendar and the day's tasks. Small feature, but it forces three decisions the dashboard
has not had to make before, and each one is a privacy or accessibility fork:

- **Where does the location come from?** Browser geolocation gives precise coordinates and a permission
  prompt on load; a stored home location gives neither. ADR-015 already refused permission-on-load for
  push notifications ("denial-by-reflex"), and §5.3's posture is that we hold as little sensitive data
  as the feature actually needs. A GPS fix is the most sensitive datum this dashboard would ever touch.
- **Who calls the provider?** Open-Meteo is CORS-enabled and needs no API key, so a direct client fetch
  is _technically_ possible — which makes it the first case where ADR-004 ("all domain data via the
  API") could plausibly be waived. It should not be, and the reason is not dogma (below).
- **How do you render a forecast without relying on icons and colour?** The canonical weather UI is a
  row of pictograms and a blue-to-red temperature ramp — i.e. two NFR-11 violations wearing a trench
  coat.

Also in play: NFR-8 (Open-Meteo's free tier is non-commercial, ≤ 10 000 calls/day — free, but not
free to abuse), NFR-2 (a third-party call must not sit inside our p95), NFR-12 (units and formats are
locale-bearing: °C and m/s in Finland), and ARD §2's failure posture (a dead upstream degrades to
cached content, not to a dead card).

## Decision

### Frontend

`apps/web/widgets/weather/` (`id: "weather"`), a standard SDK widget (§4.2), **instantiable per
location** — the ADR-013 pattern (one definition, per-instance settings) means "Helsinki" and "Tokyo"
are two cards, not a location switcher inside one card.

- `settingsSchema` (zod): `{ location: { name, lat, lon, timezone } , units: { temp: 'c'|'f' (default
'c'), wind: 'ms'|'kmh'|'mph' (default 'ms'), precip: 'mm'|'in' (default 'mm') }, days: 3|5|7 (default 5),
showPrecipProbability: boolean (default true) }`. Latitude/longitude are stored **rounded to 2 decimal
  places** (≈ 1.1 km) — enough for a forecast, not enough to point at a building.
- The settings panel's location field is a search box (city name → the API's geocoding proxy), plus an
  optional **"Use my current location"** button. That button is the _only_ path that touches
  `navigator.geolocation`, it fires on an explicit click, and what it stores is the rounded coordinate
  and a resolved place name — never a live position, never a stream, no `watchPosition`, nothing
  persisted at full precision. If the permission is denied, the search box is still there and the widget
  works; the widget never prompts on mount.
- Data through generated hooks against `/api/v1/weather`; `staleTime` aligned with the server TTL so a
  dashboard reload doesn't re-ask.

### Backend

A small `WeatherModule` (§4.1: controller → service → provider adapter → cache repository), no worker
job, no events.

- **The API proxies Open-Meteo; the client never calls it.** Even though it would work in the browser:
  (1) a client-side call sends the user's **IP address and coordinates** to a third party on every
  dashboard load — NFR-7's "no third-party trackers" is about who gets to observe the user, and a weather
  provider watching every page open is exactly that observation; (2) a server cache serves every device
  and every reload from one upstream call, which is both politeness and NFR-2 (a cached read is a
  Postgres hit, not a 300 ms round trip to Germany); (3) provider swap stays an adapter change
  (Open-Meteo's non-commercial terms are a licence we should be able to exit); (4) ADR-004 says so, and
  waiving it for the one endpoint where the temptation exists is how a rule stops being a rule.
- **Cache shape:** `GET /weather` reads `weather_cache` keyed by `(lat2, lon2, units_hash)`. A miss (or
  an entry older than its TTL) fetches upstream **inline** — unlike ADR-021's markets widget, there is
  no worker poll here, because the symbol set is unbounded in principle and the data is cheap and
  keyless. TTLs: **15 min** for current conditions, **60 min** for the daily forecast (the model itself
  updates hourly; polling faster is noise). A stale-but-present entry is served immediately and
  refreshed in the background (stale-while-revalidate), so a slow upstream never blocks the card.
- **Geocoding** (`GET /weather/geocode?q=`) proxies Open-Meteo's geocoding API, cached 30 days per
  query — city coordinates do not move.
- **Failure posture:** upstream down → serve the last cached entry with `stale: true` and its
  `fetchedAt`; only a cold cache with a dead upstream returns an error the widget can show. Weather is
  the definition of "degrade, don't die".

### Data model

Postgres `weather_cache` — **shared, not user-scoped** (public forecast data for a coordinate; the same
documented exception as ADR-013's curriculum and ADR-021's `market_quotes`). No RLS policy needed: the
client never reads it, only `WeatherModule` does.

```sql
create table weather_cache (
  id          uuid primary key default gen_random_uuid(),
  lat         numeric(6,2) not null,      -- rounded: the cache key is also a privacy control
  lon         numeric(6,2) not null,
  units_key   text not null,              -- 'c|ms|mm' — units are requested upstream, never converted here
  payload     jsonb not null,             -- normalised { current, daily[] } — provider-neutral shape
  as_of       timestamptz not null,       -- provider's model/observation time
  fetched_at  timestamptz not null,
  source      text not null default 'open-meteo',
  unique (lat, lon, units_key)
);
```

No user data is stored by this module **at all**: the location lives in the user's
`widget_layouts.settings` (JSONB, per §4.2 — it is genuinely presentation config, unlike ADR-021's
watchlist, which is data), and the cache is keyed by coordinate, not by user. A dump of
`weather_cache` reveals that _someone_ asked about Helsinki, and nothing else. That property is a
deliberate design output, not an accident.

**Units are requested from the provider, not converted by us** (`temperature_unit=celsius&wind_speed_unit=ms`)
— the units are part of the cache key. Client-side unit conversion is a rounding-bug generator, and a
cached Fahrenheit payload derived from a Celsius one would drift from the provider's own rounding.

### API contract

Under `/api/v1/weather`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007),
reject-unknown-fields on:

- `GET /weather?lat=&lon=&days=&tempUnit=&windUnit=&precipUnit=` →
  `{ location: { lat, lon }, current: { tempC, feelsLike, windSpeed, windDir, code, label, isDay },
daily: [{ date, min, max, code, label, precipMm, precipProbability, sunrise, sunset }],
asOf, fetchedAt, stale: boolean, attribution }`.
  `lat`/`lon` are **coerced and rounded to 2 dp server-side** — the API refuses to be a high-precision
  location oracle even if a client sends six decimals, so precision cannot leak through the cache key.
- `GET /weather/geocode?q=` → `{ results: [{ name, country, admin1, lat, lon, timezone }] }`
  (throttled; used only while typing in settings).

`code` is the WMO weather code (an integer), and `label` is the **server-resolved human string** for it
("Rain showers"). The mapping lives in the contracts package so FE and BE cannot disagree about what 61
means, and so the label is available to screen readers without the client owning a lookup table.

Errors: 400 on shape violations (including out-of-range coordinates); a cold-cache upstream failure is a
`503` with a typed body (`{ error: 'upstream_unavailable' }`) so the widget can say "Couldn't reach the
weather service" rather than rendering a generic crash; a warm cache never errors.

### Accessibility

- **Every icon has a text label next to it, always** — not a tooltip, not an `aria-label` on a
  decorative glyph, but visible text: "Thu · Rain showers · 12° / 18°". Icons are `aria-hidden`
  decoration. A forecast row that is legible only by pictogram fails NFR-11 and, honestly, fails at
  night on a phone too.
- **No colour-only encoding.** Temperature is a number and a bar whose _length_ encodes the range;
  precipitation probability is text ("60 %") plus a bar with `role="img"` and an `aria-label`
  ("60 percent chance of rain"). No blue-to-red ramp carrying meaning on its own.
- The forecast is a `<table>` (Day / Conditions / Low / High / Rain) — it is tabular data, and table
  semantics give screen readers row and column context for free. The mock renders it as styled rows;
  the semantics underneath are a table.
- Current conditions carry a single-sentence summary as visually-hidden text ("Currently 14 degrees,
  overcast, wind 4 metres per second from the south-west, as of 08:40") so the whole card is one
  coherent utterance rather than a scatter of numbers.
- `<time datetime>` on `asOf`; temperatures use `Intl.NumberFormat` with a degree unit; wind uses the
  locale's unit formatting (NFR-12). Day names come from `toLocaleDateString(undefined, { weekday: 'short' })`.
- Any sun-arc / temperature-curve animation is gated behind `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton mirroring the card (current block + N forecast rows) inside the widget's own
  suspense boundary — the shell never waits (§4.5).
- **No location set (first run):** the card shows "Set a location to see the forecast" with a direct
  button into the settings panel. It does **not** ask for geolocation, and it does not silently
  IP-geolocate on the server (a server-side IP lookup would be a quiet, un-consented location inference —
  exactly the thing the explicit-button design exists to avoid).
- **Stale:** last-known forecast stays on screen with "Updated 2 h ago · couldn't refresh" as text. The
  card never blanks and never shows a spinner over old data as if it were live (ADR-021's rule, same
  reasoning).
- **Error (cold):** inline `role="alert"` with a Retry button; a hard render failure falls through to the
  SDK fallback card.
- **Privacy rules (§5, NFR-7):** coordinates are stored rounded and only in the user's own widget
  settings; `navigator.geolocation` is called only from an explicit button press and never on mount; no
  third-party script or beacon runs on the dashboard for this widget (Open-Meteo is called
  server-to-server and never sees the user's browser); the weather cache holds no user identifier at all.
- **Attribution:** Open-Meteo's data is CC BY 4.0 and its free tier is non-commercial — the attribution
  line lives in the widget's about panel and the app's about page (ADR-011's placement rule), and the
  non-commercial condition is recorded as a licence constraint on the project, not just a footnote.
- All chrome copy through the message catalog (NFR-12).

## Consequences

- **Easier:** the widget is ~200 lines and a cache table; no key management, no worker job, no quota
  anxiety. The provider port means a swap (to met.no's Locationforecast, which has the same keyless,
  attribution-required shape) is an adapter.
- **Easier:** the "no user data in this module" property means weather needs no export endpoint, no RLS
  policy, and nothing in the §5.3 asset inventory — a feature that holds nothing cannot leak anything.
- **Harder / committed to:** we now cache third-party content in our Postgres, which means a TTL bug
  shows up as _wrong weather_, one of the few user-visible errors that erodes trust in a dashboard
  instantly. The `stale` flag and `fetchedAt` in the contract exist so the UI is never confidently wrong.
- **Committed to:** rounded coordinates end-to-end (client, API, cache key); geolocation only behind an
  explicit action; icons never carrying meaning alone; units requested upstream rather than converted.
- **Open questions for the product owner:** (1) Open-Meteo's free tier is non-commercial — fine forever for a personal
  dashboard, but it forecloses a future "publish this as a product" turn; is that worth a second adapter
  now? (2) Severe-weather warnings (FMI publishes them for Finland; Open-Meteo does not carry them) —
  worth a second provider, or is a forecast card enough? (3) Should the widget auto-adjust the calendar
  card ("outdoor event, 80 % rain") — that would need a cross-module read and belongs behind the event
  bus (§4.1) rather than an import, and is a bigger feature than it looks.

## Alternatives considered

- **Browser geolocation as the primary location source.** Rejected: it prompts on load (the
  denial-by-reflex antipattern ADR-015 already refused), it yields far more precision than a forecast
  needs, and it makes the widget useless on a desktop with a denied permission. It survives as an
  explicit, opt-in convenience button that writes a _rounded_ coordinate — the accuracy the user gets is
  identical; the data we hold is dramatically less.
- **Server-side IP geolocation as a fallback ("we'll just guess").** Rejected: an un-consented location
  inference, and wrong often enough (VPN, mobile carrier NAT) to be annoying as well as creepy.
- **Direct client → Open-Meteo fetch (no proxy).** The genuinely tempting one: keyless, CORS-enabled,
  zero backend work. Rejected: it hands the user's IP + coordinates to a third party on every dashboard
  load, it defeats shared caching (every device and reload is an upstream call), it puts a
  cross-continent round trip in the widget's critical path, and it carves an exception into ADR-004 for
  the one case where the exception is easy — which is how single-authorization-point architectures rot.
- **A worker-polled cache (the ADR-021 design).** Rejected here: markets need it because the provider
  meters us and the symbol set is small and known; weather is keyless, generous, and coordinate-keyed,
  so an inline cache-aside read with stale-while-revalidate is simpler and has no scheduler to babysit.
- **Storing weather in MongoDB.** Rejected by §4.3: a forecast payload is a cache entry keyed by
  coordinate with a TTL, not a document with a lifecycle. Postgres is where the cache table belongs, and
  the module owns it alone.
- **OpenWeatherMap / WeatherAPI.** Rejected: both need an API key (a secret to manage for a widget that
  does not otherwise need one) and both meter aggressively at the free tier; Open-Meteo asks for
  attribution instead of a key, which is a better trade for NFR-8.
- **Client-side unit conversion (fetch metric, convert to imperial in the UI).** Rejected: it splits the
  cache from what is displayed, invites rounding drift from the provider's own values, and saves nothing
  — the units are a query parameter upstream and a cache-key segment here.
