# ADR-020: Post reader widget (RSS/Atom subscriptions)

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

A Substack-style reader: subscribe to feeds, see what's new, read the post in a clean view inside
Command Center instead of in five newsletter tabs, save the good ones. It is the first widget whose
content is **authored by someone else** — everything before it (tasks, mood, journal, lessons) was
either the user's own writing or curriculum we ingest ourselves. That changes the threat model, and
most of this ADR follows from it.

Forces:

- **Remote HTML is the hazard.** §5.2 is unambiguous: never `dangerouslySetInnerHTML`; journal rich
  text is stored as structured JSON and rendered through a component renderer. Feed content is
  attacker-influenced markup by definition (a compromised or hostile blog is a supply chain into our
  DOM), so it gets the _stricter_ of the treatments the ARD already applies, not a looser one.
- **The browser cannot fetch feeds.** Almost no feed sends permissive CORS headers, so fetching must
  happen server-side regardless — which is convenient, because it is where sanitisation and politeness
  belong anyway.
- **Politeness is a real obligation.** Polling someone else's server on a schedule requires conditional
  requests, a sane interval, an identifying User-Agent and backoff. Getting this wrong gets us blocked
  and is simply rude.
- **Data shape.** Posts are variable-shaped documents with a body — the §4.3 Mongo column. Feed
  subscriptions are flat rows with poll state, queried and updated transactionally by the worker — the
  Postgres column. This widget lands exactly on the split and must not fudge it.
- NFR-7 (no third-party trackers), NFR-8 (cost/bandwidth), NFR-11, NFR-12 apply as usual; §4.5's
  worker + pg-boss (ADR-005) is the polling substrate.

## Decision

### Frontend

Two surfaces, following the ADR-016 journal precedent (glanceable card + dedicated route for the long
read):

- **Widget** `apps/web/widgets/post-reader/` (`id: "post-reader"`): a list of the newest unread posts —
  feed name, title, reading time, relative age; a filter segment (Unread / Saved / All); an unread
  count pill. `settingsSchema`: `{ listCount: 3–10 (default 5), filter: 'unread'|'saved'|'all',
loadRemoteImages: boolean (default false), markReadOnOpen: boolean (default true) }`.
  `quickActions`: "Add feed", "Refresh".
- **Route** `/reader/[postId]`: the clean reading view — deep-linkable, browser-back works, no
  focus-trapped modal (ADR-016's reasoning, reused). The card never renders a post body.
- **The body renders from structured JSON, never from an HTML string.** The API serves a block document
  (`{ type: 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'image' | 'hr', … }`) and the route
  maps block types to React components. There is no HTML string anywhere in the client, so
  `dangerouslySetInnerHTML` is not "avoided" — it has nothing to be called with.
- **Remote images are off by default.** An image block renders as a labelled placeholder ("Image —
  tap to load") until the user enables `loadRemoteImages` for that feed. Rationale: a remote `<img>` is
  a read-receipt and an IP beacon for the publisher; NFR-7 forbids third-party trackers on our pages,
  and a tracking pixel is one whether we call it analytics or not. When enabled, images load direct with
  `referrerpolicy="no-referrer"`, `loading="lazy"`, `decoding="async"` and the block's own width/height
  (no layout shift). A same-origin image proxy is the honest fix; see open questions.

### Backend

A new `ReaderModule` (§4.1: controller → service → repositories; no cross-module imports), plus a worker
job. It owns both `reader_feeds` (Postgres) and `reader_posts` (Mongo) — one owner, two stores, no
cross-database joins: `feedId` is an opaque id and the API composes (§4.3).

- **Polling (worker, pg-boss).** One recurring job per feed, jittered, interval ≥ 30 min (default 60,
  never below the feed's own `Cache-Control: max-age` / `<sy:updatePeriod>`). Every request is
  conditional (`If-None-Match` / `If-Modified-Since` from the stored `etag`/`last_modified`); a 304 is
  the common case and costs almost nothing. A descriptive `User-Agent`
  (`CommandCenter/1.0 (+https://…; personal reader)`) identifies us. Failures back off exponentially
  (1 h → 24 h); after 10 consecutive failures the feed is marked `broken` and shown as such in the
  widget rather than being silently retried forever.
- **Fetch hardening (SSRF).** Feed URLs are user-supplied, so: http(s) only; DNS resolved and rejected
  if it lands on private/loopback/link-local/metadata ranges (checked again after every redirect); ≤ 3
  redirects; 10 s timeout; 5 MB body cap; response must parse as RSS/Atom/JSON Feed. Adding a feed by
  page URL performs `<link rel="alternate">` discovery under the same rules.
- **Sanitise-and-structure at ingest, once.** The fetched entry HTML is parsed, run through a strict
  allowlist sanitiser (`sanitize-html`: `p h2 h3 ul ol li blockquote pre code strong em a img figure
figcaption hr`; attributes limited to `href`/`src`/`alt`/`title`; `href` limited to `http(s)`/`mailto`;
  everything else — `script`, `style`, `iframe`, `on*`, `javascript:`, tracking pixels ≤ 1 px — dropped)
  and then **converted to the block-document JSON** that the API serves. Sanitising at ingest means the
  expensive, risky step runs once per post in a background job, never on the read path (NFR-2).
- **The raw HTML is stored but never served.** `raw.html` is kept on the document so the allowlist can
  be widened and posts re-parsed without re-fetching (feeds truncate and rotate). The read contract has
  no field for it and the repository projects it out; an e2e test asserts that no reader response body
  contains an HTML tag. Storage, not serving — the distinction is enforced by the contract, not by care.
- **No summarisation, no full-text extraction of the linked page in v1** (Readability-style scraping of
  the origin site is a separate consent/ToS question). Feeds that publish excerpts show excerpts plus a
  "Read on the site" link.

### Data model

Postgres `reader_feeds` (owner: `ReaderModule`, RLS `user_id = auth.uid()`):

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
  load_remote_images boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (user_id, feed_url)
);
```

Poll state is relational, mutated by the worker in the same Postgres transaction that enqueues the next
job (ADR-005's transactional-enqueue benefit) — that is why it is not in Mongo.

MongoDB `reader_posts` (owner: `ReaderModule`, every doc carries `userId` per §4.4):

```
{ _id, userId, feedId,                       // opaque cross-store reference
  guid, url, title, author, publishedAt, fetchedAt,
  excerpt, readingMinutes,
  blocks: [ { type, … } ],                   // sanitised, structured — what the API serves
  raw: { html, contentType },                // never serialised into any response
  readAt: Date|null, savedAt: Date|null }
// unique index (userId, feedId, guid); index (userId, readAt, publishedAt desc); (userId, savedAt desc)
```

Read/saved flags live on the post document because each subscriber holds their own copy — one write,
one index, no join across stores. Retention: unsaved, read posts older than 90 days are pruned by a
worker job (Atlas M0 is 512 MB — NFR-8 is a storage constraint, not just a billing one); saved posts are
never pruned.

### API contract

Under `/api/v1/reader`, JWT-guarded, zod contracts shared FE/BE (ADR-004/007), reject-unknown-fields on:

- `GET /feeds` → `{ items: Feed[] }` (with `status`, `unreadCount`).
- `POST /feeds` `{ url }` → 201 with the feed; performs discovery + the first fetch **synchronously**
  so the user learns immediately that a URL is not a feed. Duplicate URL for the same user returns the
  existing feed (200), not a second row.
- `DELETE /feeds/:id` → 204; deletes the feed and its unsaved posts (saved posts survive, orphaned by
  design, with the feed title denormalised on them).
- `POST /feeds/:id/refresh` → 202, enqueues an immediate poll; throttled to 1/5 min per feed (§5.2), so
  a refresh-mashing user cannot make us hammer a publisher.
- `GET /posts?filter=unread|saved|all&feedId=&cursor=&limit=` → cursor-paginated list of **post
  summaries** (no blocks — the card must not pull bodies).
- `GET /posts/:id` → the full post including `blocks`.
- `PATCH /posts/:id` `{ readAt?: string|null, savedAt?: string|null }` → toggles read/saved; nulling
  restores unread/unsaved. Idempotent.
- `GET /export` → JSON dump of feeds + saved posts, and an **OPML** feed list (NFR-7: exportable, and
  the reader-specific form of "your subscriptions are yours").

Errors: 400 for shape violations; `POST /feeds` failures are typed (`not_a_feed`, `unreachable`,
`blocked_host`) so the UI can say something useful; missing/foreign ids are uniform 404s; provider
faults are opaque 500s.

### Accessibility

- The list is a `<ul>`; each item's primary control is a link to `/reader/[postId]` whose accessible
  name is the post title (never "Read more"). Unread state is text + weight (`<span class="sr-only">
Unread</span>` plus bold), never a coloured dot alone.
- The reading route renders a real `<article>` with an `<h1>`, correct heading order for the post's own
  headings (block headings are demoted so a post's `<h1>` cannot compete with the page's), landmarks,
  and a `max-width: 68ch` measure.
- Save/read toggles are `<button aria-pressed>` with text labels ("Save", "Saved"); state changes
  announce through a polite live region; failures use `role="alert"` (house pattern).
- Blocked images render a _visible_ placeholder with the image's `alt` text as its label and a real
  "Load image" button — no hover-only reveal, no silent hole.
- Code blocks from posts are `<pre tabindex="0" role="region">` with `overflow-x: auto` inside the
  measure — the page never scrolls horizontally (NFR-11, ADR-013's rule).
- All widget/route chrome copy goes through the message catalog (NFR-12); ages use
  `Intl.RelativeTimeFormat`. Post content is content — never translated, and `lang` is set from the
  feed's declared language so a screen reader switches voice.

### UX states & interaction

- **Loading:** skeleton rows in the card; the reading route streams the article shell then the body.
- **Empty (no feeds):** "No feeds yet — paste a blog or Substack URL." with the add-feed input inline;
  the empty state _is_ the affordance (ADR-017's rule).
- **Empty (no unread):** "You're all caught up." — never an error, never a nag about a reading streak.
- **Error (feed broken):** the feed row shows "Couldn't fetch — last succeeded 3 days ago" with a Retry
  button; one broken feed never breaks the card. API/Mongo down → the SDK fallback card.
- **Open a post:** navigates to the route; `markReadOnOpen` marks it read optimistically (PATCH), with
  rollback + inline alert on failure. "Mark unread" is always available — read state is a convenience,
  not a one-way door.
- **Unsubscribe** uses the shared undo pattern (ADR-008): optimistic removal, ~6 s Undo whose timeout
  pauses on focus/hover (WCAG 2.2.1), restoring via re-`POST /feeds`.
- **Privacy:** no analytics on reader routes (NFR-7); remote images off by default (above); nothing
  about what Anna reads leaves the server. Push notifications about new posts, if ever added, carry the
  feed name only — never post titles (§5.2's "no sensitive content in push bodies", applied honestly:
  reading habits are sensitive).

## Consequences

- **Easier:** the whole widget is one module riding rails that already exist — pg-boss for polling,
  the event-free read path, the SDK's error/suspense isolation. Adding a feed is one row and one job.
- **Safer by construction:** hostile markup is neutralised at ingest and the read contract cannot carry
  markup at all; the client has no HTML-injection call site to audit. SSRF is closed at the fetcher.
- **Harder:** we own an HTML→blocks converter and its fidelity gaps (embedded tweets, `<iframe>` videos,
  tables, footnotes all degrade to a link or are dropped). Some posts will look worse here than on the
  publisher's site — accepted, and the "Read on the site" link is always present.
- **Harder:** a second store for one feature (feeds in Postgres, posts in Mongo) means one more
  composition point. It is also the cleanest illustration of §4.3 in the codebase.
- **Committed to:** politeness (conditional GETs, ≥ 30 min intervals, identifying UA, backoff) as a
  correctness requirement, not a nicety; images-off-by-default; retention pruning of unsaved posts.
- **Open questions for Anna:** (1) an image proxy (`GET /reader/img?u=<signed>`, host-allowlisted to the
  post's origin, size-capped, no private-IP redirects, cached) would give images _and_ privacy — worth
  the bandwidth on the small backend instance (NFR-8), or is the per-feed opt-in enough? (2) paywalled
  Substack posts arrive as excerpts; do we want authenticated feed URLs (secret in the feed URL — a
  credential we would then be storing) or accept excerpt-only? (3) full-text search over saved posts
  (Atlas Search) — worth it, or is "saved" a small enough shelf to scroll?

## Alternatives considered

- **Sanitise the HTML and inject it with `dangerouslySetInnerHTML`.** The industry-standard answer, and
  rejected: §5.2 already refuses this for _our own_ journal content, so accepting it for arbitrary
  remote content would be exactly backwards. It also makes our safety depend on a sanitiser's CVE record
  forever, whereas the block model has no injection site at all.
- **Render posts in a sandboxed `<iframe srcdoc>` with a null origin + restrictive CSP.** A genuinely
  strong isolation story, and the closest runner-up. Rejected for v1: it breaks theming and typography
  (the whole point of a "clean reading view"), complicates height management and in-frame links, and
  puts an origin boundary in the middle of the reading experience — for content we are already
  structurally sanitising anyway.
- **Client-side feed fetching (`fetch(feedUrl)` from the browser).** Rejected: CORS makes it fail for
  most feeds, it exposes Anna's IP and reading schedule to every publisher, and it can't do conditional
  polling, caching or backoff. It also contradicts ADR-004 (domain data through the API).
- **A hosted feed API (Feedly/Inoreader/Superfeedr).** Rejected: a third party learns everything Anna
  reads (NFR-7 in spirit), most useful tiers cost money (NFR-8), and it removes the interesting half of
  the problem — this is a learning vehicle (G3).
- **Store posts in Postgres as JSONB.** Rejected: this is the archetypal document — variable body, no
  relational query beyond "recent by feed" — and §4.3 assigns it to Mongo. (The ADR-003 fallback still
  applies globally if Mongo is ever folded in.)
- **Store the sanitised HTML string instead of blocks.** Rejected: it re-creates an injection site the
  moment anyone renders it, and it puts presentation (markup) rather than meaning (structure) in the
  store — the same reasoning ADR-016 used for ProseMirror JSON.
- **Poll from the API process instead of the worker.** Rejected: ARD §3.1 keeps long jobs out of the
  interactive process; a slow feed must never eat an API request slot.
