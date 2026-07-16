# ADR-031: Home Assistant integration widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending Anna's approval

## Context

The README lists Home Assistant (HA) integration under Future Extensions. **ARD §5.3 explicitly says: "automations execute only `notify` actions in v1 — no arbitrary webhooks/code — so a compromised automation record can annoy, not exfiltrate. Revisit before adding webhook actions or Home Assistant control."** This ADR is that revisit. Nothing is implemented.

This is not a widget with a database table; it is an **integration**, and it breaks assumptions the rest of the system is built on:

- **Reachability.** HA runs on Anna's LAN (a Pi, a NUC, a container at `homeassistant.local:8123`). Our API runs on Railway/Fly (§3). **A cloud backend cannot reach a device behind a home NAT.** Every other integration in this system talks _outward_ to a public API; this one has to talk _inward_ to a private network. The ARD has faced this exactly once before — AnkiConnect (§4.5): "AnkiConnect is a plugin on the _desktop_ Anki app — a cloud backend can't reach it. Design: the browser talks to AnkiConnect on `localhost:8765` directly." That precedent is the most important input to this ADR. (ADR-026's 2026-07-16 rewrite retires the Anki _instance_ of the pattern — Anki sync now runs in CI against AnkiWeb — but the pattern itself, browser-direct to a service the cloud can't reach, stands, and this ADR now carries it alone.)
- **Credential custody.** HA authenticates with a **long-lived access token** — a bearer token, typically 10-year expiry, that grants the _full_ HA API: read every sensor, call every service, unlock every lock. There is no scoped/read-only token in HA. Whatever holds that token holds the house.
- **Threat model expansion.** Everything Command Center can do today is confined to data. HA _control_ means a compromised automation, a stored-XSS in a widget, or a leaked token can **act on the physical home** — turn off the freezer, unlock a door, disable the alarm. That is a category change, not an increment, and §5.3 anticipated it.
- **Automation overlap.** HA has a mature, local, offline-capable automation engine. Command Center has `AutomationModule` (ADR-015) with cron + event triggers and notify actions. Building "if motion then light" in Command Center would be a strictly worse HA.

## Decision

### Connectivity: browser-direct-to-LAN, the AnkiConnect precedent

**The browser talks to Home Assistant directly; the Command Center API never does.** The widget calls HA's REST API at a user-configured base URL (`http://homeassistant.local:8123` or the user's own HTTPS reverse-proxy hostname) from the client, as ADR-011's original Anki flow did. When Anna is on her home network the widget works; when she is not, the widget shows a clear "not reachable from this network" state and degrades — it does not fall back to a cloud path.

Consequences accepted deliberately:

- **The backend has no HA dependency at all** — no outbound-from-cloud problem, no tunnel, no relay, no HA credentials in our infrastructure. `FinanceModule`-style backend work is _zero_: there is no `HomeAssistantModule` in v1.
- **The widget is home-network-only.** This is honest: a phone on cellular cannot see the house. Anna already has the HA companion app for that. Command Center's job is the dashboard she has open on the desk.
- **Mixed content is the sharp edge.** Our app is HTTPS (Vercel); a plain-HTTP `http://homeassistant.local:8123` request from an HTTPS page is blocked by the browser. **This is the one real blocker** and it has three outs: (a) HA behind a local HTTPS reverse proxy with a real certificate (Anna's own domain + Let's Encrypt via DNS-01 — the clean answer); (b) HA's own SSL configuration; (c) a Tailscale/`*.ts.net` HTTPS hostname (Tailscale issues real certs), which additionally makes it work off-network. **Q-A below flags this for Anna — it constrains her HA setup, and the widget is unbuildable without one of them.** Additionally, CSP (§5.2) must be extended with a `connect-src` entry for that host — a _named host_, never a wildcard.
- **REST, not WebSocket, in v1.** HA's WebSocket API gives push state updates (nice) at the cost of a persistent connection, subscription lifecycle, reconnect/backoff, and message-sequencing code in the widget. A dashboard card showing a handful of sensors is fine with **polling every 15–30 s** (with `visibilitychange` pausing when the tab is hidden). WebSocket is the obvious upgrade once "state is stale for 20 s" actually annoys, and the state-shape parsing is shared between them — the seam is cheap.

### Token custody

**The HA long-lived token lives in the browser, in `localStorage`, and never leaves the device.** It is never sent to the Command Center API, never stored in Postgres, never in a log line, never in an error report (Sentry, NFR-10, gets a scrubber rule for it).

Rationale: our servers gaining a full-control token for Anna's house would mean a breach of a hobby backend becomes a breach of her home. Keeping the token client-side means **our compromise radius does not include the house** — the token is exposed only to the same origin that already runs our JS, so it adds no _new_ attacker (an attacker with XSS on our origin can already do anything the user can). It is a strictly smaller surface than the server-side alternative, and it preserves the property §5.3 wanted.

The honest cost: `localStorage` is readable by any XSS on our origin. Our CSP is nonce-based with no inline script (§5.2), which is the mitigation; the token is also per-device (set up on each browser) and revocable in one click from HA's own UI. Server-side custody would _not_ fix XSS anyway — it would just add server compromise as a second path to the same outcome, plus a proxy endpoint that must itself be authorized.

**We will not build a server-side proxy for HA calls in v1.** If reachability ever forces one (see Alternatives: Nabu Casa), the token moves server-side and this decision is re-opened with a full §5 review.

### Scope: read-only v1

**v1 is read-only: display entity states.** Temperatures, humidity, whether the door is open, whether the washing machine is running, power draw. No switches, no scenes, no locks, no service calls. The widget issues `GET /api/states/{entity_id}` (or `GET /api/states` filtered client-side to the configured entities) and renders them.

**Control (`POST /api/services/...`) is gated behind an explicit second decision** — a follow-up ADR, not a follow-up ticket. What that ADR must settle before any toggle ships:

1. **An entity allowlist.** Control is opt-in per entity, chosen in widget settings from HA's entity list; a bug or an injected string can only act on entities Anna explicitly enabled. No "call any service" surface, ever.
2. **A denylist of categories that stay uncontrollable regardless**: locks, alarm panels, garage doors, covers. Command Center will not unlock Anna's front door. If she wants that, the HA app does it with HA's own auth.
3. **Confirmation and undo posture** for physically consequential actions — and an explicit acceptance that a compromised _automation_ (§5.3) could now actuate hardware, which means **HA actions must never be exposed as an `AutomationModule` action type** (see below).
4. **Re-review of §5.3's "a compromised automation can annoy, not exfiltrate"** — that sentence stops being true the moment control ships, and the ARD text must change with it.

Read-only means the token is _still_ full-control (HA has no read-only tokens — the token can do everything even if our UI doesn't), so this is a UI-scope decision, not a capability boundary. Stated plainly so nobody mistakes it for defence in depth. The real defences are: token stays client-side, CSP is tight, and the automation engine cannot touch HA at all (next section).

### Automation boundary

**Command Center's automation engine does not talk to Home Assistant. Ever.** HA's automations stay in HA.

- We will **not** add an `action: { type: "home_assistant" }` to `AutomationModule` (ADR-015). Its actions remain notify-only. This preserves §5.3's property — a tampered `automations` row can annoy, not actuate — _even after_ control ships in the widget, because the server-side engine has no token and no route to the LAN anyway. The architecture makes it impossible rather than forbidden, which is the better kind of rule.
- We will **not** rebuild HA's trigger engine (motion → light, sunset → lamps, presence detection). HA does this locally, offline, in milliseconds; a cloud round trip through our worker would be slower, less reliable, and dependent on our uptime for the user's lights to work. **That is an unacceptable coupling for a hobby project's SLA (NFR-4, ~99%).**
- **The seam, if Anna ever wants Command Center events to influence the house** ("when I finish a pomodoro, dim the lights"): the _browser_ fires an HA **webhook** (`/api/webhook/{id}` — an unguessable, single-purpose, non-authenticated-by-token endpoint HA provides for exactly this) on the relevant client-side event, and **HA's own automation** decides what to do. Command Center says "this happened"; HA decides what it means. This keeps the trigger logic where it belongs, needs no service-call permissions, and the webhook id is a far weaker credential than the long-lived token. Flagged as Q-C — it is a nice pattern but still a physical-actuation path and deserves its own review.

### Frontend

One folder `apps/web/widgets/home-assistant/`, one registry entry (§4.2):

- `id: "home-assistant"`, `sizes: ["2x2", "4x2"]`; standard error + suspense boundaries — an unreachable HA must never break the dashboard (§4.2 isolation, NFR-4).
- `settingsSchema` (zod): `{ baseUrl: string (url), entityIds: string[] (max 12), pollSeconds: 15 | 30 | 60 (default 30), showLastUpdated: boolean (default true) }`. **The token is deliberately _not_ in `settingsSchema`** — widget settings are persisted server-side in `widget_layouts.settings` (§4.2/§4.4), which would ship the token straight to the database this ADR just decided it must never reach. Token entry is a separate in-widget flow writing to `localStorage` only. **This is the subtle trap in the whole design** and is called out here so an implementer cannot fall into it.
- Rows render entity friendly name, state, unit, and a relative "updated 2 min ago"; stale data (older than 3 poll intervals) is visually and textually marked stale rather than shown as current.
- Data does **not** go through `packages/contracts`/TanStack-generated hooks (there is no `/api/v1` endpoint); it uses a small HA client module with its own zod schemas for HA's state payloads — untrusted external input, validated at the boundary like everything else (§5.2).

### Accessibility

- Entity rows are a real `<ul>`; each row's accessible name carries the full meaning ("Living room temperature, 21.4 degrees Celsius, updated 2 minutes ago"). State is never conveyed by an icon or color alone (WCAG 1.4.1) — "Door: open" is text; the red dot is decoration (`aria-hidden`).
- Polling updates go in a **`aria-live="off"`** region: a dashboard card whose numbers change every 30 s must not narrate itself. Values are read on demand. Only _transitions the user asked to watch_ (a future feature) or **connection state changes** ("Home Assistant unreachable") announce, via `role="status"` / `role="alert"`.
- Units are rendered via `Intl.NumberFormat` and the entity's `unit_of_measurement`; copy externalized (NFR-12). "2 min ago" via `Intl.RelativeTimeFormat`.
- If control ships: toggles are native `<input type="checkbox" role="switch">` (the ADR-015 rule — never a div with a click handler), ≥44×44 px, with the pending/failed state announced (`role="alert"` on failure — a light that didn't turn on must not fail silently).
- No animation on state change beyond a brief highlight, dropped under `prefers-reduced-motion` (NFR-11).

### UX states & interaction

- **Unconfigured (default):** an explanatory setup card — base URL field, "create a long-lived token in HA → Profile → Security", and an explicit line: _"The token is stored in this browser only and is never sent to Command Center's servers."_ Honesty about custody is part of the UX.
- **Reachable:** entity rows + last-updated. **Unreachable (off home network, HA down, mixed-content blocked):** a distinct, non-alarming state — "Not reachable from this network" with the last-known values shown _greyed and dated_, not hidden. Distinguish "wrong network" (fetch failed fast) from "bad token" (401 → "Token rejected — recreate it in HA") from "blocked by browser" (mixed content → link to the HTTPS setup note); three different problems, three different messages.
- **Error:** the widget's error-boundary fallback; a broken HA integration never blanks the dashboard.
- Polling pauses when the tab is hidden and resumes with an immediate fetch on `visibilitychange`.

### Open questions for Anna

- **Q-A (blocking):** how is HA exposed? The widget needs an **HTTPS** endpoint reachable from the browser (local reverse proxy with a real cert, HA's own SSL, or Tailscale HTTPS). Plain `http://homeassistant.local:8123` from our HTTPS origin is **blocked by the browser** and there is no workaround. This must be settled before any implementation; it constrains her home setup, not our code.
- **Q-B:** is read-only actually useful to her, or is the whole point turning things off from the desk? If control is the point, this ADR's real deliverable is the follow-up control ADR + the §5.3 rewrite, and the read-only v1 is a stepping stone rather than a destination.
- **Q-C:** the HA-webhook-from-browser pattern ("pomodoro done → HA dims lights") — attractive, still a physical-actuation path. Worth its own review?
- **Q-D:** Nabu Casa (HA Cloud, ~€6.50/mo) — she may already pay for it. It would make server-side integration _possible_, but this ADR argues that is the wrong direction anyway (see Alternatives). Worth knowing before committing.

## Consequences

- **The §5.3 property survives**: a compromised Command Center backend, database, or automation record still cannot touch the house — our servers hold no HA credential and have no route to the LAN. This is the single most valuable outcome of the browser-direct design, and it is achieved architecturally, not by policy.
- **Zero backend work, zero infra cost, zero new dependency** (NFR-8, G2). No `HomeAssistantModule`, no worker jobs, no tunnels.
- **The widget only works at home** — a real, permanent limitation of this design, and the correct trade for a _desk dashboard_. If off-network access ever becomes a requirement, that is a different architecture (server-side proxy + Nabu Casa) and a different threat model, and it must be a new ADR.
- **CSP gets a named `connect-src` exception** for the HA host — a small, reviewable widening of §5.2. Never a wildcard.
- We are committed to **HA never becoming an `AutomationModule` action type**, and to Command Center never reimplementing HA's trigger engine. If Anna wants house automations, she writes them in HA — where they run locally, offline, and faster.
- Control remains **unshipped and explicitly gated**: it requires its own ADR, an entity allowlist, a hard denylist (locks/alarms/garage), and an edit to ARD §5.3's threat text. Nobody can add a toggle "while they're in there".
- The token-not-in-`settingsSchema` trap is documented; an implementer who ignores it silently ships the house key to Postgres.

## Alternatives considered

- **Server-side integration via Nabu Casa remote URL** (HA Cloud gives a public HTTPS endpoint our API could call). Rejected: it requires storing a full-control, 10-year HA token in our backend, which makes a breach of a hobby project's database a breach of Anna's home — precisely the escalation §5.3 warned about. It also adds ~€6.50/mo (NFR-8) and makes the lights depend on _our_ uptime. The browser-direct path gets the same UI with none of that.
- **Server-side integration via a self-hosted tunnel** (Cloudflare Tunnel, ngrok, a WireGuard peer from the API host into the LAN). Rejected: same token-custody escalation, plus it punches a persistent hole from a cloud host into the home network — the worst combination in this document. Also real ops burden (G2).
- **WebSocket API for live state.** Rejected _for v1_ only: reconnect/backoff, subscription lifecycle, and message ordering are real code for a card showing six sensors, where 30 s polling is indistinguishable to a human. Adopt when a use case (a live power meter, a doorbell) makes staleness actually hurt — the parsing layer is shared, so the upgrade is cheap.
- **Control (switches/scenes) in v1.** Rejected: it converts every existing vulnerability class in the app from "data exposure" into "physical actuation", and §5.3 explicitly demands a revisit before that. Read-only first buys the reachability, token, CSP, and staleness problems being solved _before_ the stakes rise. Gated behind an entity allowlist + a hard denylist + its own ADR.
- **HA actions as an `AutomationModule` action type** ("at 22:00, turn off the lights"). Rejected on two independent grounds: it would put a full-control token in the backend (see above), and HA's own scheduler already does this locally, better, without depending on our worker being alive. Duplicating it would be building a worse HA with a bigger blast radius.
- **Storing the HA token in `widget_layouts.settings`** (the natural place — it _is_ a widget setting). Rejected: those settings persist to Postgres via the API (§4.2/§4.4), which is exactly where this ADR decided the token must never go. Hence the deliberate exclusion from `settingsSchema` — the trap is called out in the Frontend section so it cannot be re-introduced by accident.
- **Proxying HA calls through our API to dodge mixed-content/CORS** (the "just add a backend route" reflex). Rejected: it re-introduces server-side token custody to solve a browser-configuration problem that HA's own HTTPS setup solves properly.
- **Rebuilding HA's automations in Command Center** (presence, motion, sunset triggers). Rejected: strictly worse in latency, reliability, and offline behaviour, and it would make household lighting depend on a personal project's ~99% availability (NFR-4). The webhook seam (Q-C) lets Command Center _inform_ HA instead — the right direction for the dependency.
