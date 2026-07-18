# ADR-020: RSS feed widget (headlines + excerpts, link out)

- **Status:** Accepted
- **Date:** 2026-07-16 (rewrite of the 2026-07-14 draft at PO review)
- **Review:** claude-reviewed, PO-reviewed

## Context

The 2026-07-14 draft of this ADR designed a full in-app **reader**: post bodies fetched, sanitised into
a block-document JSON, stored in Mongo, and read on a dedicated `/reader` route. At the product-owner
review (2026-07-16) that turned out to be more than the want: the want is a classic **RSS feed** — a
glanceable card of what's new across subscribed feeds, with a headline and a couple of lines of excerpt,
that you click to **read on the publisher's site**. This rewrite records the redirected design (the
ADR-024/026 precedent: rewritten in place by PO decision; the reader design survives in git history and
is the starting point if an in-app reading view is ever actually wanted).

Forces:

- **Remote text is still untrusted.** Feed titles and summaries are attacker-influenced content. The
  answer gets _simpler_ under the new scope, not looser: everything ingested is stripped to **plain
  text** — no markup is stored anywhere, so §5.2 has nothing to police on the read path.
- **The browser cannot fetch feeds** (almost no feed sends permissive CORS), so fetching is server-side
  — where politeness and hardening belong anyway.
- **Politeness is a real obligation.** Conditional requests, sane intervals, an identifying User-Agent,
  backoff. Getting this wrong gets us blocked and is simply rude.
- **Data shape: the Mongo justification is gone.** A headline item (title, url, excerpt, date, two
  flags) is a flat row queried relationally — the Postgres column of §4.3. The draft's two-store split
  existed only because bodies were stored; without them this is a one-store module.
- NFR-7 (no third-party trackers; reading habits are sensitive), NFR-8, NFR-11, NFR-12; §4.5's worker +
  pg-boss (ADR-005) as the polling substrate.

## Decision

### Frontend

One surface — the widget. **No reading route**: clicking an item opens the publisher's page in a new
tab; the dashboard's job is the glance, the publisher's job is the reading.

- `apps/web/widgets/post-reader/` (`id: "post-reader"`): newest items — feed name, title, a 1–2 line
  **plain-text excerpt**, relative age; a filter segment (Unread / Saved / All); an unread count pill.
- `settingsSchema` (zod): `{ listCount: 3–10 (default 5), filter: 'unread'|'saved'|'all' (default
'unread'), showExcerpt: boolean (default true), markReadOnOpen: boolean (default true) }`.
  `quickActions`: "Add feed", "Refresh".
- The item's primary control is a real external link (`target="_blank"`, `rel="noopener"`); opening it
  optimistically marks the item read (`markReadOnOpen`), with rollback + inline alert on failure.
- Data through generated hooks against `/api/v1/reader` (ADR-004/007); no direct provider or Supabase
  access.

### Backend

A `ReaderModule` (§4.1: controller → service → repository; no cross-module imports) plus a worker job.
Postgres only — one owner, one store.

- **Polling (worker, pg-boss).** One recurring job per feed, jittered, interval ≥ 30 min (default 60,
  never below the feed's own `Cache-Control: max-age` / `<sy:updatePeriod>`). Every request is
  conditional (`If-None-Match` / `If-Modified-Since` from the stored `etag`/`last_modified`); a 304 is
  the common case. A descriptive `User-Agent` (`CommandCenter/1.0 (+https://…; personal reader)`)
  identifies us. Failures back off exponentially (1 h → 24 h); after 10 consecutive failures the feed is
  marked `broken` and shown as such rather than silently retried forever.
- **Fetch hardening (SSRF).** Feed URLs are user-supplied, so: http(s) only; DNS resolved and rejected
  if it lands on private/loopback/link-local/metadata ranges (re-checked after every redirect); ≤ 3
  redirects; 10 s timeout; 5 MB body cap; response must parse as RSS/Atom/JSON Feed. Adding a feed by
  page URL performs `<link rel="alternate">` discovery under the same rules.
- **Plain text at ingest, once.** Entry title and summary are stripped of all markup (tags removed,
  entities decoded, whitespace collapsed), the excerpt capped at ~300 characters on a word boundary.
  **No HTML is stored in any form** — there is no raw column, no block document, no sanitiser allowlist
  to maintain; an e2e test asserts no reader response body contains an HTML tag (kept from the draft,
  now trivially true). Post bodies are never fetched; enclosures/media are ignored in v1.

### Data model

Postgres only, owner `ReaderModule`, RLS `user_id = auth.uid()`:

```sql
create table reader_feeds (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id),
  feed_url      text not null,
  site_url      text,
  title         text not null,
  etag          text,
  last_modified text,
  poll_interval_minutes int not null default 60 check (poll_interval_minutes >= 30),
  last_fetched_at timestamptz,
  failure_count int not null default 0,
  status        text not null default 'ok' check (status in ('ok','failing','broken')),
  created_at    timestamptz not null default now(),
  unique (user_id, feed_url)
);

create table reader_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id),
  feed_id      uuid references reader_feeds (id) on delete set null,  -- saved items survive a feed delete
  feed_title   text not null,              -- denormalised: survives the feed, names the orphan
  guid         text not null,
  url          text not null,              -- http(s) validated at ingest
  title        text not null,              -- plain text
  excerpt      text,                       -- plain text, ≤ ~300 chars
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  read_at      timestamptz,
  saved_at     timestamptz
);
create unique index on reader_items (user_id, feed_id, guid) where feed_id is not null;
create index on reader_items (user_id, read_at, published_at desc);
create index on reader_items (user_id, saved_at desc) where saved_at is not null;
```

Poll state is mutated by the worker in the same transaction that enqueues the next job (ADR-005).
Retention: **unsaved** items older than 90 days are pruned by a worker job (read or not — the feed has
long moved on); **saved** items are never pruned. Deleting a feed deletes its unsaved items; saved ones
stay, orphaned by design, still carrying `feed_title` and their link.

### API contract

Under `/api/v1/reader`, JWT-guarded, zod contracts shared FE/BE (ADR-004/007), reject-unknown-fields on:

- `GET /feeds` → `{ items: Feed[] }` (with `status`, `unreadCount`).
- `POST /feeds` `{ url }` → 201 with the feed; discovery + first fetch run **synchronously** so the user
  learns immediately that a URL is not a feed. A duplicate URL returns the existing feed (200).
- `DELETE /feeds/:id` → 204 (see retention above for what survives).
- `POST /feeds/:id/refresh` → 202, enqueues an immediate poll; throttled to 1/5 min per feed (§5.2).
- `GET /items?filter=unread|saved|all&feedId=&cursor=&limit=` → cursor-paginated item list. There is no
  `GET /items/:id` — an item _is_ its list row; there is nothing more to fetch.
- `PATCH /items/:id` `{ readAt?: string|null, savedAt?: string|null }` — toggles; nulling restores.
  Idempotent.
- `GET /export` → JSON dump of feeds + saved items, and an **OPML** feed list (NFR-7: the reader-specific
  form of "your subscriptions are yours").

Errors: 400 for shape violations; `POST /feeds` failures are typed (`not_a_feed`, `unreachable`,
`blocked_host`); missing/foreign ids are uniform 404s; provider faults are opaque 500s.

### Accessibility

- The list is a `<ul>`; each item's primary control is a link whose accessible name is the post title
  (never "Read more"), with "opens the publisher's site" appended as visually-hidden text and a visible
  `↗` glyph (`aria-hidden`) — an external jump is never a surprise.
- Unread state is text + weight (`<span class="sr-only">Unread</span>` plus bold), never a coloured dot
  alone. The save toggle is a `<button aria-pressed>` with text labels ("Save" / "Saved"); state changes
  announce through a polite live region; failures use `role="alert"` (house pattern).
- Excerpts are plain text in the item body — no markup, nothing focusable inside them.
- Chrome copy through the message catalog (NFR-12); ages via `Intl.RelativeTimeFormat`. Item titles are
  content — never translated; `lang` is set from the feed's declared language so screen readers switch
  voice.

### UX states & interaction

- **Loading:** skeleton rows in the card.
- **Empty (no feeds):** "No feeds yet — paste a blog or Substack URL." with the add-feed input inline;
  the empty state _is_ the affordance (ADR-017's rule).
- **Empty (no unread):** "You're all caught up." — never an error, never a nag.
- **Error (feed broken):** the feed row shows "Couldn't fetch — last succeeded 3 days ago" with a Retry
  button; one broken feed never breaks the card. API down → the SDK fallback card.
- **Unsubscribe** uses the shared undo pattern (ADR-008): optimistic removal, ~6 s Undo whose timeout
  pauses on focus/hover (WCAG 2.2.1), restoring via re-`POST /feeds`.
- **Privacy:** no analytics on the widget (NFR-7); nothing about what the user reads leaves the server —
  the publisher sees the user only when the user actually clicks through, which is inherent to reading
  on their site (and no referrer beyond that click: the dashboard URL is not the publisher's business —
  `rel="noopener"` plus `referrerpolicy="no-referrer"` on item links). Push notifications about new
  posts, if ever added, carry the feed name only — never item titles (reading habits are sensitive).

## Consequences

- **The simplest external-content widget possible:** one Postgres table pair, a polite poller, and a
  list. No Mongo collection, no HTML→blocks converter, no sanitiser allowlist, no reading route, no
  image policy — the draft's four hardest problems dissolved by scoping to what was actually wanted.
- **Safer than the draft, for free:** plain-text-only ingest means there is no markup anywhere in the
  system — no injection surface to harden, no sanitiser CVE exposure, nothing for the e2e no-HTML
  assertion to catch.
- **Given up, knowingly:** in-app reading. Excerpt-only means the publisher's site (with its cookies,
  paywalls, and popups) is the reading experience. If that ever grates enough to matter, the block-based
  reader design lives in this file's git history (pre-2026-07-16) and would return as a new ADR — it is
  a strict superset of this design, so nothing built here is thrown away.
- **Committed to:** politeness (conditional GETs, ≥ 30 min intervals, identifying UA, backoff) as a
  correctness requirement; plain-text-only content permanently (rich rendering re-opens this ADR);
  90-day pruning of unsaved items; OPML in the export.

## Alternatives considered

- **The full in-app reader (this ADR's own 2026-07-14 draft).** Sanitised block-document bodies in
  Mongo, a `/reader` route, per-feed image opt-in. Rejected at PO review as more than the want: the
  point is a feed to glance, not a reading app — and every hard part of the draft (HTML conversion
  fidelity, image privacy, a second store) existed only to serve the part that wasn't wanted.
- **Sanitised HTML excerpts (keep a little markup for bold/links in summaries).** Rejected: two lines of
  preview text do not need markup, and keeping any HTML path means keeping the sanitiser, its allowlist,
  and its CVE surface for cosmetic gain.
- **Client-side feed fetching.** Rejected: CORS fails for most feeds, it exposes the user's IP and
  reading schedule to every publisher on every dashboard load, and it can't do conditional polling or
  backoff. ADR-004 forbids it besides.
- **A hosted feed API (Feedly/Inoreader/Superfeedr).** Rejected: a third party learns everything the
  user reads (NFR-7 in spirit), useful tiers cost money (NFR-8), and it removes the interesting half of
  the problem (G3).
- **Mongo for items.** Rejected under the new scope: an item is a flat row with two flags and no body —
  §4.3's Postgres column. (The draft's Mongo half was justified only by stored bodies.)
- **Poll from the API process instead of the worker.** Rejected: ADR §3.1 keeps long jobs out of the
  interactive process; a slow feed must never eat an API request slot.
