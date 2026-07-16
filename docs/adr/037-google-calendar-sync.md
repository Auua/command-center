# ADR-037: Google Calendar sync (per-calendar read-only and read-write)

- **Status:** proposed
- **Date:** 2026-07-16
- **Review:** claude-reviewed — pending product-owner approval

## Context

ADR-018 shipped the calendar as own-events CRUD and **explicitly deferred external sync**, leaving
a schema seam (`source`/`external_id`) and naming the costs that made it a separate project: OAuth
consent and refresh-token custody, webhook-or-polling transport in the worker, and a
read-only-vs-two-way policy. The product owner has now asked for exactly that project: Google
Calendar in the dashboard, with some calendars **read-only** (subscribed/shared calendars that
should render but never be touched) and at least one **read-write** (events created or edited in
the dashboard land in Google). ADR-033 deliberately bought the *public* slice of this (holidays)
without OAuth; this ADR pays the real bill for the private slice.

Forces:

- **A new top-tier credential (§5.3).** A calendar-scope Google refresh token reads much of the
  user's life, and a write-scope token can silently modify or delete it. This joins journal/mood
  data in the highest-value asset tier and must be custodied accordingly.
- **Sync must run with no browser open.** The mirror has to be fresh when the dashboard loads, so
  the token must live server-side where the worker can use it — the opposite trade from ADR-031,
  where the browser-only token was the point (there the risk was actuating the physical house and
  a read-only browser path sufficed; here background operation is the requirement and the risk is
  data exposure, mitigated by encryption and scope minimization, not by keeping the backend out).
- **The read path must stay local (NFR-2).** Dashboard reads can never call Google; ADR-021
  already established worker-polls / read-serves-cache as the house shape for third-party data.
- **Google operational realities.** Calendar scopes are "sensitive": an OAuth app in *testing*
  status expires refresh tokens after 7 days (weekly re-consent — unusable); *production* status
  without verification shows a one-time unverified-app warning, acceptable for a personal app.
  Push notifications (watch channels) require a public HTTPS webhook and expire (~week), needing
  renewal machinery. Incremental sync via `syncToken` is cheap and quota is far beyond
  personal-scale need (NFR-8: €0).
- **Recurring events are the trap.** Google models series as master + overrides
  (RECURRENCE-ID); ADR-018 deliberately deferred the override model for our own events. Importing
  Google's would force it in through the side door.
- **G2 / low ops.** One worker, one Postgres; no new services.

## Decision

### Provider and grant: Google only, OAuth code flow, server-held refresh token

We will integrate **Google Calendar only** (no generic CalDAV/ICS layer) via the OAuth 2.0
authorization-code flow. The connect flow lives in calendar settings; the API exchanges the code
and stores the refresh token **encrypted at rest** (AES-256-GCM, key from platform env per §5.2)
in a new `calendar_accounts` table. The token never reaches the client, is never logged, and is
decrypted only in the worker/API process at call time. The OAuth app runs in **production status,
unverified** — testing status's 7-day refresh-token expiry makes it structurally unfit; the
one-time consent warning is recorded here as accepted. Disconnecting an account revokes the token
at Google (`oauth2.revoke`), deletes the stored credential, and **purges that account's mirrored
rows** — the mirror is a cache of Google's data, not user data we retain.

**Scopes are incremental (least privilege):** the initial connect requests only
`calendar.calendarlist.readonly` + `calendar.events.readonly`. The write scope
(`calendar.events`) is requested — with a second, explicit consent — only when the user first
marks a calendar read-write. A read-only-forever setup therefore never holds a token that *could*
write. Google scopes are account-wide, so per-calendar write policy is enforced by our `mode`
column (API-level 403) with Google's own per-calendar ACL as the outer net.

### Per-calendar subscription with an explicit mode

Nothing syncs by default. The settings surface lists the account's calendars (from
`calendarList`); the user selects which to sync and sets each to `read` or `write`:

`calendar_sources` — `id uuid PK`, `user_id` (RLS anchor), `account_id FK → calendar_accounts`,
`google_calendar_id text`, `display_name text`, `color text`, `mode text CHECK (mode IN
('read','write'))`, `sync_token text null`, `last_synced_at timestamptz null`,
`sync_error text null`. UNIQUE `(account_id, google_calendar_id)`.

`calendar_events` (ADR-018) gains the anticipated seam, now concrete: `source_id uuid null FK →
calendar_sources (on delete cascade)`, `external_id text null`, `external_etag text null`;
UNIQUE `(source_id, external_id)`; CHECK (`source_id IS NULL` ⇔ `external_id IS NULL`). Own
events have `source_id NULL`; RLS is unchanged.

### Transport: worker-polled incremental sync; push channels deferred

A pg-boss recurring job (ADR-005) syncs each source **every 10 minutes**: `events.list` with the
stored `syncToken` (only deltas cross the wire), upserting/deleting mirror rows by
`(source_id, external_id)`; HTTP 410 GONE triggers the documented full-window resync. Watch
channels (push) are **deferred**: they need a public webhook endpoint plus expiry-renewal
machinery to convert 10-minute freshness into ~1-minute freshness — the wrong complexity trade
for a personal dashboard (same shape of reasoning as ADR-021's no-poll-on-read, inverted). The UI
is honest about it: each source shows `last_synced_at` ("synced 4 min ago"), mirroring the
house rule that staleness is displayed, not hidden (ADR-021's `asOf`, ADR-035's timestamp).

Failure handling: provider 5xx/429 → exponential backoff, mirror serves stale (labelled); a
refresh-token failure (`invalid_grant` — user revoked, password change) marks the account
`needs_reauth` and surfaces a reconnect banner on the widget and settings — **never a silent
stall**. `sync_error` per source makes partial failure visible.

### Recurring events: mirror concrete instances, not series

We will sync with **`singleEvents=true` over a rolling horizon (past 30 days → future 400
days)**: Google expands its own recurrence (including overrides and this-and-following splits)
and we store **concrete occurrence rows**. This sidesteps importing Google's master+override
model — the exact model ADR-018 deferred — and means synced events flow through the existing read
contract unchanged: clients already consume concrete occurrence lists, which ADR-018 called out
as the payoff that would make "a future external-sync source indistinguishable to the frontend".
The horizon is re-covered on every full resync and rolled forward by the sync job, so the window
never goes stale. The costs are honest: an event more than ~13 months out isn't visible yet
(it enters the window as time advances), and unbounded series occupy at most the window.

### Write policy: write-through, Google is the source of truth

On a `mode='write'` source, create/edit/delete goes **to the Google API first**; only on success
is the mirror row written (with the returned `etag`). Updates and deletes send
`If-Match: <external_etag>`; a 412 means the event changed remotely since our last sync — the API
returns 409 with the fresh remote copy and the client re-renders it for the user to redo the edit
on current data. **Last-writer never silently wins in either direction.** There is no offline
queue (offline-first is a §1.3 non-goal): if Google is unreachable, the write fails visibly and
the mirror stays consistent.

v1 write scope is **single events only**: creating or editing *recurring series* on a Google
calendar stays in Google's own UI (the edit dialog hides recurrence controls for synced events).
Series edit semantics (this / this-and-following / all) are Google's hardest UX; re-implementing
them against a mirror of expanded instances is a project of its own and is deferred, not designed
badly now. Deleting a single synced occurrence maps to deleting that instance at Google.

On a `mode='read'` source the UI renders no edit/delete affordances and the API rejects writes
with 403 regardless of what the client sends. Task-deadline markers and projected recurring-task
occurrences (ADR-018 / ADR-036) remain a dashboard-side overlay and are **never pushed to
Google**.

### Widget & UX integration

- Synced events merge into the existing agenda/day/week/month views; each carries its source
  calendar's color **and name in text** (chip label and accessible name: "Standup — Work
  calendar, read-only" — never color-alone, NFR-11).
- Read-only is conveyed in the accessible name and detail view, not just by missing buttons.
- All-day events from Google arrive as dates and land in ADR-018's `starts_on/ends_on` date
  columns — the shift-proof representation holds for imported data too; timed events arrive as
  instants with timezone and are stored as `timestamptz`, rendered per ADR-018's home-timezone
  rule.
- The settings panel (per-source toggle, mode, reconnect) extends the calendar widget's
  `settingsSchema` where it fits the auto-generated panel; account connect/reconnect is a real
  settings page under `/calendar` (an OAuth redirect cannot live inside a widget card).
- Empty/degraded states follow ADR-018; a source in `needs_reauth` or `sync_error` renders a
  labelled inline banner with the recovery action, and its last-good events remain visible.

### Security summary (§5.3 update owed on approval)

New assets: encrypted Google refresh token(s); mirrored calendar rows. Mitigations: AES-256-GCM
at rest with env-held key; read-only scopes until write is explicitly requested; per-calendar
mode enforced API-side; no client access to tokens ever; disconnect = revoke + delete + purge;
sync traffic only from the worker/API egress; no calendar content in push notification bodies
(§5.2 applies unchanged). Rate limiting and zod reject-unknown-fields apply to the new endpoints
as everywhere.

## Consequences

- The dashboard becomes a genuine calendar client: Google events appear within 10 minutes,
  read-write calendars accept edits that land in Google, and the frontend needed **no read-model
  changes** — ADR-018's expanded-occurrence contract absorbed an external source exactly as
  designed.
- We now custody a high-value long-lived credential. The encryption key becomes a real secret to
  manage (rotation = re-encrypt column), and "backend compromised" now includes "attacker reads —
  and if write scope was granted, edits — the user's Google calendar" until revocation. This is
  the accepted price of background sync; ADR-031's browser-only alternative was considered and
  doesn't fit (documented in Context).
- Freshness is 10-minute-bounded, not live. Accepted for a personal dashboard; watch channels are
  the recorded upgrade path if it grates in daily use.
- The instance-mirror model caps visibility at the rolling horizon and makes "edit this series
  from the dashboard" structurally out of scope until an override model exists. Both limits are
  visible, stated, and reversible (a resync rebuilds the mirror under a new model).
- A second OAuth-shaped integration now exists alongside ADR-024's PAT and ADR-026's Actions
  secrets; if a third arrives (ADR-029's fitness deferral names the same seam), extracting a
  shared encrypted-credential store is warranted — noted, not built.
- ARD edits owed on approval: §2 context diagram (+Google Calendar API), §4.4 (new tables +
  `calendar_events` columns), §5.3 (asset tier), §7 row, Phase 4 scope line. ADR-018's deferral
  paragraph is amended in place to point here.

## Alternatives considered

- **Generic CalDAV/ICS sync layer** — rejected: ICS subscription is read-only and unversioned
  (polling whole files; ADR-033 already rejected it for holidays), Google's CalDAV endpoint is
  legacy with worse fidelity than its REST API, and the actual requirement is Google. A second
  provider, if ever wanted, gets its own adapter behind the same `calendar_sources` shape.
- **Watch channels (push) in v1** — deferred: public webhook + channel-renewal jobs buys
  ~1-minute freshness where 10 minutes is honest and sufficient; the poll job is one pg-boss
  schedule. Revisit on felt staleness, not speculation.
- **Importing Google series as RRULE masters + overrides** — rejected: forces ADR-018's deferred
  override model immediately, plus Google-specific quirks (floating overrides, split series) —
  the highest-complexity path to the same rendered pixels. Concrete instances over a horizon match
  the read contract as-is.
- **Mirroring our own events *up* to a Google calendar (full two-way)** — deferred: doubles the
  conflict surface and creates echo-loop risk (our write → their webhook/poll → our mirror). The
  ask — see Google events, edit some calendars — is satisfied by mirror + write-through; own
  events stay ours.
- **Browser-held token (ADR-031's pattern)** — rejected: sync must run unattended; a token in
  `localStorage` can't feed the worker, and per-device consent would multiply grants. ADR-031's
  reasoning was specific to LAN actuation and is not a house default.
- **Service account** — rejected: domain-wide delegation works only for Workspace tenants, not a
  personal Google account.
- **Sync-all-calendars by default** — rejected: hold the least data that serves the product;
  explicit selection also keeps the settings honest about what the app can see.
- **Editing read-only calendars locally ("local overrides")** — rejected outright: a mirror that
  disagrees with its source manufactures the class of bug sync exists to remove.
- **Skipping etags (last-writer-wins)** — rejected: silent clobbering of concurrent edits on the
  write path of someone's real calendar is data loss, not a simplification.
