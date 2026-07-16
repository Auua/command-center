# ADR-016: Journal widget — editor choice, data model, and editing surface

- **Status:** proposed
- **Date:** 2026-07-13

## Context

The Journal widget (Phase 4) is the reflection centerpiece: rich-text entries with prompts, tags, timeline browsing, and full-text search. The ARD constrains it heavily: entries live in MongoDB as structured JSON owned by `JournalModule` (§4.3), all access goes through the REST API at `/api/v1` (ADR-004), full-text search uses Atlas Search (§4.3), rich text is stored as the editor's JSON doc and rendered only through the editor's renderer — never `dangerouslySetInnerHTML` — with sanitization on ingest as defense in depth (§5.2). Journal data is the highest-value, most-private asset in the system (§5.3): no third-party analytics on journal routes, and NFR-7 requires the data to be exportable.

The dashboard mock (`docs/design/dashboard-mock.html`, "Journal · today's prompt" card) shows the widget as a **launcher**: a daily prompt plus a "Write today's entry" button. Actual writing happens in a dedicated full-screen editor view, so the widget itself stays small and the heavy editor code stays off the dashboard bundle.

Open question **Q2** in ARD §8 — TipTap vs Plate vs Lexical — must be closed here, because the rich-text data format _is_ the editor's JSON doc model and is therefore sticky: every stored entry is committed to it. This ADR closes Q2.

The widget's core UX promise is **never lose writing**. A journal that eats an entry once is never trusted again.

## Decision

### Editor choice

**We will use TipTap (ProseMirror) as the journal editor, and the ProseMirror JSON document as the canonical stored format.**

Reasons, against the alternatives evaluated below:

- **Doc-model stability (the sticky-format criterion, weighted highest).** TipTap documents are ProseMirror documents: a schema-validated node tree whose JSON shape has been stable for close to a decade. The schema is explicit and enforced by the editor itself, which pairs naturally with §5.2's server-side allowlist validation. Lexical's JSON serialization is coupled to editor node classes and a still-0.x API surface; Plate inherits Slate's history of breaking data-model changes.
- **A11y and input track record.** ProseMirror has years of hardening around contenteditable, IME/composition (relevant for future Japanese-language entries, NFR-12), and screen-reader behavior. Lexical's a11y pedigree (built at Meta for exactly this) is genuinely strong — it is the runner-up — but it does not outweigh the format-stability gap. Slate's Android/IME record is the weakest of the three.
- **React 19 / RSC compatibility.** All three are client-side; TipTap's `@tiptap/react` works cleanly as a client component under React 19, and TipTap ships `generateHTML`/`generateText` utilities usable in Node for server-side text extraction without a DOM.
- **Rendering path.** Read-only display uses TipTap's renderer over the stored JSON (a read-only editor instance or static render from the same schema) — satisfying §5.2's "render through the editor's renderer" verbatim.
- **Maintenance and bundle.** Core is MIT with an active ecosystem; we use only free extensions (StarterKit subset + Link). Lazy-loaded on journal routes only, the ~60–80 kB gz cost never touches the dashboard bundle.

We pin the allowed document vocabulary (see Data model) and record `schemaVersion` on every entry so the format is a deliberate, versioned commitment rather than an accident of editor defaults.

### Frontend

- **Widget = launcher.** The dashboard card shows: today's prompt, a primary CTA, and a recent-entry indicator (last entry date + streak-friendly "written today" check). No editor code loads on the dashboard.
- **Editor = dedicated route, not a modal.** `/journal` (timeline), `/journal/new?date=YYYY-MM-DD&promptId=…`, `/journal/[entryId]`. A route wins over an overlay because: entries are deep-linkable (search results, "edit today's entry"), mobile gets a true full-screen surface with sane virtual-keyboard behavior, browser back/forward works without focus-trap and scroll-lock machinery, and an accidental navigation is survivable because of autosave. The editor page is a client component loaded via `next/dynamic`.
- **Autosave policy (the "never lose writing" contract):**
  - Every keystroke updates an **IndexedDB draft immediately** (keyed by entry id or `draft:YYYY-MM-DD` for new entries). Local persistence is synchronous with typing, not debounced.
  - Server sync: `PATCH` debounced **2 s after last edit**, with a **10 s max interval** while typing continuously; also flushed on blur, visibility change, and route leave.
  - **Conflict handling:** every entry carries an integer `version`; `PATCH` sends the base version and the server returns **409** if it doesn't match (entry edited from another device/tab). On 409 the client never overwrites: it shows both timestamps and offers "keep this draft" (saves as the new head) or "discard my changes". Single-user reality makes this rare; the rule exists so it is safe when it happens.
  - The IndexedDB draft is deleted only after the server confirms the save. If the API is unreachable, editing continues locally with a persistent "Saving locally — will sync" notice and retry with exponential backoff.
- **Privacy:** journal routes carry no third-party analytics or trackers (§5.3, NFR-7 — global policy, restated here as binding for `/journal/*`).

### Backend

- **`JournalModule`** (NestJS) owns everything journal: entries, prompts, search. Thin controllers, rules in services, Mongo access through the `userId`-scoping repository base class (§5.1).
- **Events, not imports:** on the first successful save of an entry for a given `entryDate`, the service emits **`journal.entry_created`** `{ userId, entryId, entryDate }` on the in-process event bus. Streak accounting (LearningModule/streaks) and automations subscribe; `JournalModule` imports neither.
- **Prompts:** a seeded `journal_prompts` collection (owner: JournalModule; texts externalized per NFR-12 as per-locale strings). Daily pick is **deterministic**: `hash(userId + isoDate) mod count(activePromptsInSelectedCategories)` — same prompt all day, no state to store, stable across devices.
- **Ingest validation (§5.2 restated as decisions):**
  - The doc is validated server-side against a **zod schema in `packages/contracts`** that mirrors the exact TipTap schema. **Allowlist only**: nodes `doc, paragraph, heading(level 1–3), bulletList, orderedList, listItem, blockquote, horizontalRule, hardBreak, text`; marks `bold, italic, strike, code, link`. Unknown node/mark types, unknown attrs, and unknown fields are **rejected** (400), not stripped silently.
  - Additional limits: max doc size 256 kB, max nesting depth 20; `link.href` must be `http(s):` (no `javascript:`/`data:`).
  - The server **re-derives** `plainText`, `textPreview`, and `wordCount` from the validated doc via `generateText` — client-supplied derived fields are ignored. Defense in depth: even a bypassed renderer rule can't ship script, because nothing executable can be stored.

### Data model

MongoDB `journal_entries` (owner: JournalModule):

```jsonc
{
  "_id": "ObjectId",
  "userId": "uuid", // always filtered; from JWT, never the body
  "entryDate": "2026-07-13", // user-local date; one primary entry/day, extras allowed
  "doc": {/* TipTap JSON, allowlisted schema */},
  "schemaVersion": 1, // doc-format version, for future migrations
  "plainText": "…", // server-derived; Atlas Search source
  "textPreview": "…", // first ~280 chars, for timeline cards
  "wordCount": 412,
  "tags": ["gratitude", "work"],
  "promptId": "ObjectId | null",
  "version": 7, // optimistic-concurrency counter
  "createdAt": "…",
  "updatedAt": "…",
}
```

`journal_prompts`: `{ _id, text: { en, fi?, ja? }, category, active }` — seeded, editable later.

**Atlas Search** index `journal_search` on `journal_entries`: `plainText` (analyzed, per-locale analyzer later), `tags` (keyword), `entryDate` (date facet), always compound-filtered on `userId`. Atlas M0 allows the needed search index within its 3-index cap (NFR-8).

### API contract

All under `/api/v1/journal`, JWT-guarded, zod-validated (ADR-004/007):

| Method | Path                          | Purpose                                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------------------- |
| GET    | `/prompts/today?categories=`  | deterministic daily prompt                                                |
| GET    | `/entries?from&to&tag&cursor` | timeline: previews only, cursor-paginated, newest first                   |
| GET    | `/entries/:id`                | full doc for the editor/reader                                            |
| POST   | `/entries`                    | create; emits `journal.entry_created`                                     |
| PATCH  | `/entries/:id`                | autosave; body carries `baseVersion`; `409` on mismatch                   |
| DELETE | `/entries/:id`                | delete (hard delete; drafts are client-side)                              |
| GET    | `/search?q=&tags=&from=&to=`  | Atlas Search over `plainText`+`tags`, returns previews + match highlights |
| GET    | `/export`                     | full JSON dump: raw docs **and** a Markdown rendering per entry (NFR-7)   |

Contract details:

- Search uses the Atlas Search `highlight` option on `plainText` so the timeline can show why an entry matched; results are previews (never full docs) and paginate with the same cursor scheme as `/entries`.
- Autosave `PATCH` is idempotent per `(entryId, baseVersion)`; retries after a network timeout cannot double-apply.
- Standard per-user rate limits apply (`@nestjs/throttler`, §5.2); the 10 s max autosave interval keeps steady typing at ≤ 6 writes/min, well inside them.
- All request/response shapes live as zod schemas in `packages/contracts`; the web app consumes the generated typed client (ADR-007) — the editor never hand-rolls fetches.

### Accessibility

Rich-text editors are an a11y minefield; these are commitments, not aspirations (NFR-11):

- **Toolbar:** `role="toolbar"` with an `aria-label`, **roving tabindex** (one tab stop; Left/Right arrows move between buttons), each mark button a real `<button>` with `aria-pressed` reflecting the active state at the caret, and `aria-keyshortcuts` documented on each.
- **Keyboard shortcuts:** Cmd/Ctrl+B/I, Cmd/Ctrl+Shift+X (strike), Cmd/Ctrl+K (link) — TipTap defaults, surfaced in a shortcuts popover.
- **Focus management:** on editor open, focus lands in the content area (title field first for new entries); on close/back, focus **returns to the invoking control** (the widget CTA or the timeline row). Esc from the toolbar returns focus to the editor content.
- **Save status:** a visually persistent indicator plus an `aria-live="polite"` region announcing state _transitions_ only ("Saving…" → "Saved" → "Saving locally — offline"), throttled so it never chatters on every keystroke.
- **Heading semantics:** editor headings 1–3 render as `h3`–`h5` in read views (offset under the page's `h1`/`h2`) so the document outline stays valid.
- **Prompt/CTA association:** the widget's prompt text is linked to the CTA via `aria-describedby`, so "Write today's entry" reads with its prompt.
- **Motion:** route/entry transitions are disabled under `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton card matching the launcher layout (prompt line + button ghost).
- **Empty (no entry today):** today's prompt + "Write today's entry".
- **Already written:** "Edit today's entry" + the entry's `textPreview` and word count; prompt hidden or collapsed.
- **Error/degraded (Mongo down):** the widget's error boundary renders the standard fallback card (§4.2); the editor stays usable with IndexedDB drafts and the local-save notice — writing is never blocked by the backend being down.
- **Offline:** identical to degraded; drafts sync on reconnect via the retry loop.
- **Multi-tab:** drafts are keyed per entry in IndexedDB; a `BroadcastChannel` heartbeat marks one tab as the active writer so two tabs on the same entry warn instead of silently racing (the version check on `PATCH` is the backstop).
- **Delete:** destructive and rare, so it confirms via an accessible dialog (focus moved in, returned on close) — no undo toast pretending to be a trash can in v1.
- **Widget SDK conformance (§4.2):** registered `WidgetDefinition` `{ id: "journal", sizes, component, settingsSchema, quickActions }`; `settingsSchema` = `{ showPrompt: boolean, promptCategories: enum[] }` (drives the auto-generated settings panel); `quickActions` = "Write entry" → `/journal/new`. Error + suspense boundaries come from the shell.
- **i18n (NFR-12):** all UI copy in the message catalog; prompts stored per-locale in `journal_prompts` — nothing user-facing is hardcoded.

## Consequences

- **Q2 is closed.** The stored format is TipTap/ProseMirror JSON, and that is real lock-in: every future reader, exporter, and mobile surface must speak it. Mitigations are structural: the **allowlisted vocabulary is deliberately tiny** (10 nodes, 5 marks — a strict superset of Markdown), `schemaVersion` is stamped on every entry, and the export endpoint always emits Markdown alongside raw JSON. Migrating this subset to any other tree format is a mechanical transform, not archaeology.
- **NFR-7 export is designed in**, not bolted on: `/export` ships raw docs + Markdown from day one, and the quarterly restore test (NFR-5) covers `journal_entries`.
- Server-side re-derivation of `plainText` means **search can never disagree with content**, at the cost of a few ms per save — acceptable against NFR-2.
- The route-based editor commits us to journal pages outside the dashboard shell (nav/back affordances needed), but buys deep links, a clean mobile surface, and a lazy-loaded editor bundle that keeps NFR-1 intact.
- Local-first drafts introduce a second persistence layer (IndexedDB) with its own edge cases (multi-tab), handled by version-checked PATCHes; the payoff is the core promise — no keystroke is ever only in memory.
- One Atlas Search index consumes a third of the M0 cap; a second journal index (e.g., autocomplete) would force a tier decision.

## Alternatives considered

- **Lexical** — best-in-class a11y/IME investment and the strongest runner-up; rejected because its JSON serialization is coupled to editor node classes on a pre-1.0 API, which is the wrong risk profile for a format we must read for years, and headless/server-side text extraction is clunkier than ProseMirror's.
- **Plate (Slate)** — rich React-first kit; rejected on Slate's historically unstable data model and weaker Android/IME record — both directly hit the sticky-format and future-Japanese-input requirements.
- **Markdown in a plain `<textarea>`** — simplest and most portable; rejected because it fails the product bar (rich text, prompts inline, future embeds) and pushes formatting syntax onto the user; kept in spirit as the export format.
- **Storing sanitized HTML** — rejected outright by §5.2: HTML-as-truth invites `dangerouslySetInnerHTML` and makes the sanitizer the only line of defense; a validated node tree makes dangerous content unrepresentable.
- **Modal/overlay editor on the dashboard** — rejected: no deep links, fragile focus-trap + scroll-lock on mobile, and an accidental Esc/backdrop click is exactly the data-loss shape this widget exists to prevent.
- **Postgres full-text instead of Atlas Search** — rejected: entries are Mongo-owned (§4.3); mirroring text into Postgres would create a cross-DB derived copy, violating the one-owner rule (ADR-003).
