# ADR-016: Journal widget — editor choice, data model, and editing surface

- **Status:** Accepted
- **Date:** 2026-07-13
- **Review:** claude-reviewed, PO-reviewed
- **Built:** 2026-11-16 as Phase 4C, search as 4C-2 — see the implementation notes below.

> **Implementation note (2026-11-16, Phase 4C).** Built as decided, with these details settled in
> the build:
>
> - **Search is a separate step (4C-2)** — see the next note. `plainText` is stored from the
>   first save, so the index covers every entry written before it.
> - **One launcher read:** `GET /journal/today?locale=&categories=` returns the home-timezone
>   date, the day's prompt (the shared `common/daily-prompt.ts` pick: sha256(userId|date) over
>   the active prompts in the chosen categories) and today's latest entry preview — it
>   subsumes `/prompts/today`, so the card makes one request.
> - **No title field.** The data model has none; a heading inside the doc is the title, and
>   focus lands in the content area.
> - **Exact vocabulary, enforced both ways.** TipTap is pinned at 3.32.2. Its JSON carries
>   `link {href, target, rel, class, title}`, `orderedList {start, type}` and `heading {level}`;
>   `JournalDocSchema` allows exactly those and rejects anything else (400). A web test runs the
>   real editor's `getJSON()` through the contract, so an editor upgrade that adds an attr fails
>   CI instead of failing saves. Pasted HTML outside the vocabulary is dropped by the editor's
>   schema; links are http(s) only on both sides.
> - **Derived text without TipTap on the server.** `plainText` / `textPreview` / `wordCount`
>   and the export's Markdown come from a pure walker in `packages/contracts`
>   (`journal-doc.ts`) — the vocabulary is small enough that the API needs no editor
>   dependency. Words are counted with `Intl.Segmenter`, so Japanese text is not one word.
> - **Idempotent retry, concretely.** A `PATCH` whose `baseVersion` is one behind and whose doc
>   and tags equal the stored ones answers 200 with the stored entry; anything else on a stale
>   version is a 409 with `currentVersion`.
> - **Body limit:** the API's JSON body limit is 320 kB (Express's default 100 kB is below the
>   256 kB doc cap); the contract enforces the real cap with a clear 400.
> - **Prompts seed on boot:** `journal_prompts` (16 English prompts in four categories:
>   reflect, gratitude, growth, feelings) is upserted with `$setOnInsert` on module init —
>   idempotent, and a prompt edited or deactivated in Atlas is never overwritten.
> - **Autosave engine:** `apps/web/lib/journal-autosave.ts`, framework-free and tested with fake
>   timers — draft on every edit, 2 s debounce / 10 s max, one request in flight, flush on blur
>   / tab hidden / page hide / leave / back online, backoff 2 s → 60 s while offline, a refused
>   save (400) is kept locally and retried on the next edit, and the draft is deleted only after
>   the server confirms its content. A new entry's URL becomes `/journal/<id>` via
>   `history.replaceState`, so the editor never remounts mid-sentence. Where IndexedDB is
>   unavailable the editor says drafts cannot be kept.
> - **Conflict UI:** a draft edited from an older version than the server's opens as a conflict
>   (both times shown) with "Keep my version" (saves on top of the server's version) and "Use
>   the saved version".
> - **Focus return** across routes uses one sessionStorage key: the widget CTA and timeline rows
>   record themselves and take focus back when shown again.
> - **Streak:** `journal.entry_created` → streak key `journal` (ADR-014), counted on the day of
>   writing, not the entry's date.
> - **Export** is also a button on the timeline (a JSON download), not only the endpoint.
> - **Default layout:** the card sits after Streaks with Appreciation beside it (ADR-017's
>   placement); existing dashboards add it through Edit layout → Add widget.

> **Implementation note (2026-11-16, Phase 4C-2 — search).** Built as decided, with these
> details settled in the build:
>
> - **The API creates the index.** `JournalSearchService` creates `journal_search` when it is
>   missing — on boot and again on a search while it is not ready — with
>   `createSearchIndex` (the app's database user has `readWrite`, which carries
>   `createSearchIndexes`). The "created by hand in Atlas" step is gone; the definition lives
>   in code (`apps/api/src/journal/search.ts`) and the setup guide keeps a by-hand fallback.
>   An index that exists is left alone, so a later definition change must be applied in Atlas.
> - **Static mapping:** `userId` and `entryDate` as `token` (equality, range, sort), `_id` as
>   `objectId` (the tie-break), `plainText` as `string` with `lucene.standard`, and `tags` as
>   both `token` (exact filter) and `string` (a word query matches a tag). `lucene.standard` is
>   language-neutral without stemming, so an inflected Finnish word matches only that form —
>   the per-locale analyzer stays a later change.
> - **Every word must match** (`text` with `matchCriteria: "all"` over `plainText` + `tags`);
>   date range, tag and the cursor are non-scoring `compound.filter` clauses.
> - **Newest first, not by relevance.** Results sort by `entryDate` desc, `_id` desc in
>   `$search`, so they page with the timeline's own `entryDate|_id` cursor (as the contract
>   below asks) and read as a filtered timeline; the highlights show why each matched.
> - **User scoping twice.** `UserScopedRepository.searchForUser` adds an `equals` on `userId` to
>   the compound filter and a `$match: { userId }` straight after `$search` (which must be the
>   first stage), so a search can no more skip the user than a `find` can.
> - **503, never a silent empty list.** `$search` against a missing index returns no documents
>   rather than an error, so the service checks `$listSearchIndexes` first: until the index is
>   queryable — and where Atlas Search does not exist (the e2e mongodb-memory-server) — the
>   endpoint answers 503 and the timeline says search is not ready. A ready answer is trusted
>   for the process lifetime; a not-ready one is re-asked at most every 30 s.
> - **Highlights** come back as passages of `{text, hit}` fragments (best three, `plainText`
>   only) and render as text nodes with `<mark>` — never HTML.
> - **The query lives in the URL** (`/journal?q=&from=&to=&tag=`, the filters too), so going
>   back from an entry returns to the same search.
> - **Test seam:** the pipeline, the index definition, the highlight mapping and the readiness
>   logic are unit-tested against a fake collection; the e2e suite asserts the 503 and the
>   validation on mongodb-memory-server. A real `$search` is checked by hand once deployed
>   (`docs/PHASE4_SETUP.md`).

## Context

The Journal widget (Phase 4) is the reflection centerpiece: rich-text entries with prompts, tags, timeline browsing, and full-text search. The ADR constrains it heavily: entries live in MongoDB as structured JSON owned by `JournalModule` (§4.3), all access goes through the REST API at `/api/v1` (ADR-004), full-text search uses Atlas Search (§4.3), rich text is stored as the editor's JSON doc and rendered only through the editor's renderer — never `dangerouslySetInnerHTML` — with sanitization on ingest as defense in depth (§5.2). Journal data is the highest-value, most-private asset in the system (§5.3): no third-party analytics on journal routes, and NFR-7 requires the data to be exportable.

The dashboard mock (`docs/design/dashboard-mock.html`, "Journal · today's prompt" card) shows the widget as a **launcher**: a daily prompt plus a "Write today's entry" button. Actual writing happens in a dedicated full-screen editor view, so the widget itself stays small and the heavy editor code stays off the dashboard bundle.

Open question **Q2** in ADR §8 — TipTap vs Plate vs Lexical — must be closed here, because the rich-text data format _is_ the editor's JSON doc model and is therefore sticky: every stored entry is committed to it. This ADR closes Q2.

The widget's core UX promise is **never lose writing**. A journal that eats an entry once is never trusted again.

## Decision

### Editor choice

**We will use TipTap (ProseMirror) as the journal editor, and the ProseMirror JSON document as the canonical stored format.** -> _PO-review:_ approved after weighing Lexical's a11y/IME edge — the deciding asymmetry is that ProseMirror JSON outlives TipTap (the doc model belongs to `prosemirror-model` and parses without TipTap), while Lexical's format is coupled to Lexical's own 0.x node classes.

Reasons, against the alternatives evaluated below:

- **Doc-model stability (the sticky-format criterion, weighted highest).** TipTap documents are ProseMirror documents: a schema-validated node tree whose JSON shape has been stable for close to a decade. The schema is explicit and enforced by the editor itself, which pairs naturally with §5.2's server-side allowlist validation. Lexical's JSON serialization is coupled to editor node classes and a still-0.x API surface; Plate inherits Slate's history of breaking data-model changes.
- **A11y and input track record.** ProseMirror has years of hardening around contenteditable, IME/composition (relevant for future Japanese-language entries, NFR-12), and screen-reader behavior. Lexical's a11y pedigree (built at Meta for exactly this) is genuinely strong — it is the runner-up — but it does not outweigh the format-stability gap. Slate's Android/IME record is the weakest of the three.
- **React 19 / RSC compatibility.** All three are client-side; TipTap's `@tiptap/react` works cleanly as a client component under React 19, and TipTap ships `generateHTML`/`generateText` utilities usable in Node for server-side text extraction without a DOM.
- **Rendering path.** Read-only display uses TipTap's renderer over the stored JSON (a read-only editor instance or static render from the same schema) — satisfying §5.2's "render through the editor's renderer" verbatim.
- **Maintenance and bundle.** Core is MIT with an active ecosystem; we use only free extensions (StarterKit subset + Link). Lazy-loaded on journal routes only, the ~60–80 kB gz cost never touches the dashboard bundle. TipTap's open-core drift (paid/cloud pro extensions) is an accepted, named risk: nothing we use is gated, and because the stored format is ProseMirror's rather than TipTap's, exiting the wrapper (raw `prosemirror-*` or another PM wrapper) never touches stored entries.

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
  "entryDate": "2026-07-13", // user-local date; one primary entry/day, extras allowed (PO-confirmed)
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
| GET    | `/search?q=&tag=&from=&to=`   | Atlas Search over `plainText`+`tags`, returns previews + match highlights |
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
- **Delete:** destructive and rare, so it confirms via an accessible dialog (focus moved in, returned on close) — no undo toast pretending to be a trash can in v1. -> _PO-review:_ confirmed — hard delete behind the dialog, no trash or undo window.
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
