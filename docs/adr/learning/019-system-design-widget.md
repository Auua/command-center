# ADR-019: System-design micro-lesson widget

- **Status:** accepted
- **Date:** 2026-07-14 (amended at acceptance 2026-07-18: lessons follow ADR-013 into the
  learning repo — `pool/system-design/` authored files, `tools/lesson-ingest` runs dagre and
  emits the IR; day-pinning flips to the UTC learning day; Anki cards ship the diagram as
  media in v1; saved cards gain optional personal notes, stored in the repo card file)
- **Review:** claude-reviewed, PO-reviewed

## Context

Phase 3's learning area already has a daily micro-lesson pattern: ADR-013's `tech-lesson` widget, one
definition instantiated per track (TypeScript / SQL / Java / React), sequential curriculum, day-pinned
selection, Shiki tokens baked at ingest. A daily **system-design** lesson (load balancing, caching,
consistency models, queues, sharding) is the natural next lane of the same habit — one concept a day,
a streak, an "Add to Anki" card.

The obvious move is to add `'system-design'` to ADR-013's `track` enum and be done. The reason that
does not work is the diagram: a system-design lesson without a picture is a wall of prose. Forces:

- **Content shape diverges.** A code lesson is `{ intro, code, takeaway }`. A system-design lesson is
  `{ scenario, diagram, tradeoffs[], takeaway }` — no snippet, but a topology and an explicit
  tradeoff table (that's the pedagogy: every system-design answer is "it depends, here is on what").
  Adding it as a track would force the tech-lesson component to branch on content kind and the shared
  contract to grow optional-everything fields — which is exactly the multi-shape widget ADR-013
  rejected when it turned down the multi-track carousel.
- **Diagram rendering is a security decision.** §5.2 bans injecting stored/remote markup
  (`dangerouslySetInnerHTML`), and ADR-013 reaffirmed it for lesson content. Mermaid renders by
  building SVG through DOM injection and inline styles — both a CSP fight (nonce-based, no inline
  script) and a bundle-size fight (~500 kB) for a card that shows one static picture.
- Everything else about the widget is ADR-013's problem, already solved: day-pinning, streaks via
  `lesson.completed` (ADR-014), the shared Anki sync path (ADR-026), NFR-11/NFR-12, R5 provenance.

Ambiguity resolved here: **separate widget, shared rails.** Fork the surface (component, settings,
content sub-shape); reuse the pipeline (module, collection, progress table, events, Anki path).

## Decision

### Frontend

We will ship a distinct widget `apps/web/widgets/system-design/` (`id: "system-design"`), owned by
the same `LearningModule` backend, **not** a new track of `tech-lesson`.

- `settingsSchema` (zod): `{ area: 'fundamentals' | 'scaling' | 'data' | 'reliability' | 'all'
(default 'all'), depth: 'intro' | 'interview' (default 'intro'), showTradeoffs: boolean (default true) }`.
  Per-instance settings mean "System design · scaling" and "System design · data" can be two cards if
  the user wants two lanes — the same instantiation trick ADR-013 uses for tracks, applied to areas.
- `quickActions`: "Add to Anki" (shared queue, below) and "Mark learned"; the body holds a
  **self-check** ("Why does a health check need to be cheaper than the request it guards?") with a
  reveal button, because recall beats re-reading.
- **Diagrams render from a structured IR, never from markup.** The API returns a laid-out diagram as
  JSON (`nodes` with `x/y/w/h/label/shape`, `edges` with `points[]/label/dashed`); the widget maps it
  to React `<svg>` elements. No mermaid in the bundle, no SVG string injection, no `data:` SVG in an
  `<img>` (which would put every label outside the accessibility tree and outside theming). Node fill
  and stroke are CSS custom properties, so light/dark theming is pure CSS, exactly like ADR-013's
  dual-theme token colors.

### Backend

`LearningModule` (§4.1) gains a system-design content kind and a second controller surface; no new
module, no cross-module import.

- **Layout at ingest, not at render.** Lessons are **authored files in the learning repo** —
  `pool/system-design/<seq>-<slug>.md` (front-matter: area, depth, seq, title, tags, and ADR-032's
  required typed `license` block, `proprietary-own`; body: scenario, diagram source, tradeoffs,
  self-check, takeaway), following ADR-013's `pool/tech/` at its acceptance. The diagram is a small
  mermaid-flavoured flowchart subset (`A[Client] --> B(Load balancer)`); `tools/lesson-ingest`
  (ADR-013's tool, grown a diagram step) parses it, runs **dagre** (pure JS — deliberately no
  headless-browser/mermaid-CLI step, so ingest stays runnable anywhere) and emits the coordinate IR
  into the committed shards alongside the source. Same rationale as ADR-013's Shiki tokens: content
  is ours and changes rarely, so render cost is zero (NFR-2), the client executes no renderer, and
  nothing untrusted ever becomes markup. _(PO-review 2026-07-18: v1 supports the flowchart subset
  only — a sequence-diagram IR is added when a lesson actually needs one, not speculatively.)_
- **`altText` is a required field.** Ingest rejects a diagram without a human-authored one-sentence
  alt text; it also derives a structured node/edge outline for the hidden equivalent (below). A
  picture without a text equivalent cannot enter the collection — the validator enforces NFR-11 at
  the pipeline, not at review time.
- **Selection reuses ADR-013 verbatim:** lowest unseen `seq` in the chosen area/depth lane, frozen on
  the first request of the **UTC calendar day** (the learning day, ADR-011/012/013 as accepted —
  supersedes this draft's home-timezone pinning) into the
  lane's entry in `progress/system-design.json` (ADR-024's per-kind progress file). Same
  day-pinning, same carry-over of an unfinished lesson. Streaks credit the home-tz day per ADR-014 —
  pacing and crediting are deliberately different clocks.
- **Completion emits `lesson.completed { userId, track: 'system-design', lessonId }`** on the event
  bus; ADR-014's StreaksService credits `streaks.widget_id = 'system-design'`. No inline streak write.
- **"Add to Anki" is a repo write (ADR-024/026):** the quick action saves a card file (with
  `anki: true` front-matter) into the learning repo via the learning API; the repo's GitHub
  Action syncs it to AnkiWeb keyed on the deterministic card id, so idempotency keys off an
  exact id rather than a content hash. There is no Anki queue endpoint (ADR-011's
  `/api/v1/japanese/anki/queue` and the first ADR-026 draft's `/api/v1/anki/queue` are both
  superseded). A system-design lesson lands in the **Tech** deck (ADR-026): front = the self-check
  question, back = takeaway + the tradeoff lines as text, **plus the diagram as an image**
  (_PO-review 2026-07-18: diagrams **ship as media in v1**_): `tools/lesson-ingest` renders the
  laid-out IR to a committed image file, `media/sd-<lessonId>-<contentHash>.png` — the content
  hash in the filename is the cache-buster, so a re-laid-out diagram is a new file and a clean
  re-upload — and the learning repo's Action gains the **media-sync step** (`sync_media`, same
  pinned `anki` library and R2 posture as the note sync; a note-synced-but-media-failed run is a
  red run, fixed by rerunning). The card back references the image by filename.
- **Saved cards can carry personal notes** (_PO-review 2026-07-18, replacing the drafted free-text
  self-check question — see Open questions_): the quick action offers an optional notes input;
  ADR-024's shared card contract (`POST /cards/:kind`) gains an optional `notes` field, stored in
  the card file and mapped by every kind formatter onto a **Notes** field on ADR-026's note types
  (an additive change on the versioned models — non-destructive, like recall cards). Notes are
  durable, editable in the repo like any card content, and apply to **all card kinds**, not just
  system-design.

### Data model

Learning repo `pool/system-design/` (owner: `LearningModule` via ADR-024's read path) — _amended
at acceptance: the drafted Mongo `lesson_content` discriminated union followed ADR-013's store out
of the architecture; with `lesson_content` retired unbuilt there is no collection to discriminate,
just a sibling pool directory served through the same SHA-pinned cache._ Two committed layers,
mirroring ADR-013:

- **Authored source** — `pool/system-design/<seq>-<slug>.md`: front-matter (`area`, `depth`, `seq`
  — unique per lane, enforced by the ingest validator — `title`, `tags`, required `license` block)
  and a body carrying `scenario`, the flowchart-subset `diagram.source`, the **required
  human-written `altText`**, 2–4 `tradeoffs` rows (`choice` / `pro` / `con` — the actual lesson),
  `selfCheck` (`question` / `answer`), and `takeaway`.
- **Ingest-emitted shards** — `tools/lesson-ingest` validates fail-closed (a diagram without
  `altText`, an unparseable flowchart, a sub-AA palette, a missing `license` block, a duplicate
  `seq` all reject the lesson and the previous shards stand), runs dagre, and emits per-lesson
  `diagram.nodes` (`id, label, shape, x, y, w, h`), `diagram.edges` (`from, to, label?, points,
dashed?`), and the derived `diagram.outline` (`from, to, label?` — feeds the hidden text
  equivalent), plus the rendered `media/sd-<lessonId>-<contentHash>.png` for Anki (above).

User state rides ADR-024's per-kind progress file — `progress/system-design.json`, the same
per-lane shape as ADR-013's `progress/tech.json`, with lanes keyed `area:depth`. Reusing the shape
(rather than inventing a parallel one) is what keeps progress and the future "learning overview"
uniform; streaks stay in Postgres, credited via events (ADR-014).

### API contract

Under `/api/v1/learning`, zod schemas in `packages/contracts` (ADR-004/007), reject-unknown-fields on:

- `GET /system-design/today?area=&depth=` → `{ lesson, progress: { seq, total, streak }, previousTitle, stale }`.
  `lesson.diagram` is the IR; the response schema has **no HTML/SVG string field at all**, so
  "accidentally send markup" is unrepresentable in the contract, not merely forbidden by policy.
- `POST /system-design/:id/complete` → idempotent (re-completing is a 200 no-op), returns updated
  progress + streak.
- Anki: no new route — the quick action saves a card file through the learning API (ADR-024)
  and ADR-026's Action does the rest. This widget adds no Anki surface of its own.

Error semantics match the house rules: request-shape violations are 400 (ZodError via the global
filter); a stored shard that fails the contract is a 500 (corrupt content), never a client ZodError;
missing/foreign ids are uniform 404s. GitHub trouble degrades to `stale: true` with the last
pinned lesson from ADR-024's cache rather than an error (ARD §2 failure posture).

### Accessibility

- The diagram `<svg>` is `role="img"` with `aria-label` = the authored `altText`, and is followed by a
  **visually-hidden `<ol>` rendered from `diagram.outline`** ("Client sends to Load balancer; Load
  balancer sends to App server 1; …") so a screen-reader user can walk the topology step by step
  instead of hearing one sentence. This is the ADR-009 chart pattern (label + hidden structured
  equivalent) applied to graphs.
- Edge meaning is never carried by line style or colour alone: a dashed "async" edge also carries a
  text label, and the hidden outline states it.
- Node labels are real SVG `<text>` (not baked pixels), so they scale with browser zoom and survive
  high-contrast modes; node fills meet WCAG 2.1 AA against the card background in both themes, and the
  ingest script fails a palette below AA (ADR-013's rule, reused).
- The diagram wrapper is `tabindex="0"`, `overflow-x: auto` **within the card** — the page never
  scrolls horizontally; wide topologies scroll inside their own container.
- Tradeoffs render as a real `<table>` with `<th scope="col">` (Choice / Upside / Cost), not as
  coloured chips — a screen reader announces the pairing that is the point of the lesson.
- Self-check reveal is a `<button aria-expanded>` controlling the answer region; revealing announces
  through the widget's polite live region. Reveal/skeleton animations are gated behind
  `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton mirroring the card (kicker, title, diagram box, tradeoff rows, footer) inside
  the widget's own suspense boundary — the shell never waits on it (§4.5).
- **Empty / lane complete:** when every lesson in the area+depth lane is done, the card shows
  "Scaling · intro — all 24 done" pointing at the settings panel, signalled explicitly by the API
  (`lesson: null`), never a 404 or an empty skeleton (ADR-013's rule).
- **Error:** GitHub/API trouble serves the last pinned lesson from the repo cache with `stale: true`
  and an unobtrusive "offline copy" note; only a hard failure falls through to the SDK
  error-boundary fallback card.
- **Mark learned:** optimistic — the button flips and the streak pill increments in `onMutate`; a
  failure rolls back **and** shows an inline `role="alert"` (a silent rollback is a lie to
  screen-reader users — house pattern from ADR-013).
- **i18n (NFR-12):** widget chrome ("Mark learned", "Reveal answer", stale notice) lives in the message
  catalog. Lesson bodies and diagram labels are content, not UI, and stay English.

## Consequences

- **Easier:** a fifth learning lane arrives as content + one enum value on the backend, and the whole
  progress/streak/Anki machinery is reused untouched — the third widget to ride those rails, which is
  the strongest evidence yet that the ADR-013/014 design was right.
- **Safer by construction:** the response contract has no markup field, so the injection risk isn't
  mitigated — it's absent. Diagrams cannot carry script because they never exist as markup outside our
  own React elements.
- **Harder:** we now own a diagram authoring pipeline (flowchart subset → dagre → IR) and its
  regression risk — a layout-engine upgrade can move every diagram. Retaining `diagram.source` means
  re-layout is a scripted re-ingest, not a rewrite.
- **Harder:** the laid-out IR is denormalized. Editing a lesson's topology means re-running ingest
  for that lesson; hand-editing coordinates in the shards is explicitly not a workflow.
- **Harder:** the Action owns the media-sync step — a second protocol surface on the pinned `anki`
  library (R2's drift posture covers it: a failed media upload is a red run within a day), and a
  re-laid-out diagram is a re-rendered, re-uploaded image (the content-hash filename makes that
  clean).
- **Committed to:** required `altText` (no picture without words), lessons as authored
  `pool/system-design/` files served through ADR-024's cache, per-area widget instances, and
  optional personal notes on saved cards (repo-stored, all card kinds).
- **Open questions for the product owner:** (1) is the dagre-laid-out mermaid subset expressive enough, or do the
  first ten lessons need sequence diagrams too (a second IR shape)?
  -> _PO-review (2026-07-18):_ flowchart subset only in v1 — the curriculum is authored to what
  the IR supports; a sequence-diagram IR is added when a lesson needs it, not speculatively.
  (2) Should "Add to Anki" ship the
  diagram as media (Anki's media sync, `sync_media` — ADR-026), or is a text-only card enough?
  -> _PO-review (2026-07-18):_ **media ships in v1** — ingest renders the IR to a committed
  content-hashed PNG and the Action gains the media-sync step; the card back shows the topology
  from day one (mechanics in Backend above).
  (3) Does the
  self-check want a free-text "explain it back" field — valuable pedagogically, but it is journal-shaped
  private content and would drag a write into an otherwise read-only widget.
  -> _PO-review (2026-07-18):_ no free-text field on the self-check; instead **saved cards accept
  optional personal notes, stored in the repo card file** and mapped to a Notes field on the
  note types — durable, editable on github.com, and applicable to every card kind.

## Alternatives considered

- **Add `'system-design'` to ADR-013's `track` enum.** The default, and it loses on content shape: the
  card has no code block and gains a diagram plus a tradeoff table, so the shared component would branch
  on kind, the shared zod contract would grow optional-everything fields, and the settings panel would
  offer a `difficulty` that means something different per track. ADR-013's own reasoning (per-instance
  settings, one shape per widget) argues for a sibling, not a track.
- **Mermaid in the client (`mermaid.render()` on the stored source).** Rejected on three counts: it
  injects generated SVG/HTML into the DOM (§5.2), it needs inline styles that fight the nonce-based CSP
  (§5.2), and it puts a ~500 kB renderer in the dashboard bundle for one static picture (NFR-1).
- **Pre-render SVG at ingest and inject the string** (`dangerouslySetInnerHTML`) — rejected outright:
  identical to the stored-HTML injection ADR-013 already banned. Sanitising it first would mean owning
  an SVG sanitiser's edge cases (`<foreignObject>`, `xlink:href`, event attributes) forever.
- **Pre-rendered SVG served as `<img src="data:image/svg+xml…">`** — safe from script, but every label
  leaves the accessibility tree (a screen reader gets the alt text only), theming dies (no
  `currentColor` across the `<img>` boundary), and text stops scaling with the user's font size. The IR
  costs one ingest step and keeps all three.
- **Author diagrams as ASCII art in a `<pre>`** — genuinely injection-proof and zero-pipeline. Rejected:
  it's illegible at phone widths, unreadable to screen readers as a graph, and unstylable.
- **Mongo storage at all (the drafted `lesson_content` union, or its own `system_design_content`
  collection)** — the draft argued only about _which_ Mongo shape; both left with ADR-013's
  acceptance. Tech and system-design lessons share the repo pool, the ingest tool, and the
  SHA-pinned read path — the "one owner, one lifecycle" argument that favoured the union now
  favours one pool with sibling directories.
- **Random/shuffled daily topic** — rejected for the same pedagogic reason as ADR-013: caching before
  consistency, load balancing before sharding. Sequence is the curriculum.
