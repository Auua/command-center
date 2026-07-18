# ADR-023: Work tracker widget (wins, impact, review evidence)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Review:** claude-reviewed, PO-reviewed

## Context

Performance-review season is archaeology: six months of Slack, PRs and half-remembered incidents,
compressed into a self-assessment on a Sunday night. The fix is boring and known — write the win down
the day it happens, with enough structure that the review doc later writes itself. This widget is that
habit: one entry per achievement (what, when, which project, which skill, what kind of impact, a link
to the evidence), filterable by review period, exportable as markdown you can paste into the actual
review document.

Forces:

- **This is a §5.3-class asset.** The ADR names journal and mood as the highest-value private data;
  work-tracker entries belong in the same class and arguably above it. They contain colleagues' names,
  incident details, sometimes the honest version of a project's history, and they are compensation-
  adjacent — the one dataset here that could hurt the user professionally if it leaked. Everything the ADR
  says about journal privacy applies verbatim, plus one more rule: this data must never be inferred
  automatically (see UX).
- **Storage split (§4.3) is genuinely arguable here.** Entries have a body, which whispers "document,
  Mongo, like journal". But the _queries_ are relational — by period, by project, by impact type, counts
  per tag — and that is what the widget is for. §4.3 splits by shape and query, not by vibe.
- **Overlap with the appreciation tracker (ADR-017).** Both are "log a small good thing". A reasonable
  person would ask why they aren't one widget with a toggle. Answered below, and the answer is not
  "because the SDK says so".
- **Export is the point, not a feature.** An entry log you can't get out of the app has failed at its
  only job. NFR-7 already requires per-module JSON export; this module needs a _useful_ export, in the
  format the destination document actually wants.
- NFR-11, NFR-12 as always.

## Decision

### Frontend

`apps/web/widgets/work-tracker/` (`id: "work-tracker"`), a standard SDK widget (§4.2), plus a
`/work` route for the review-prep view (the ADR-016/020 pattern: glanceable card, dedicated route for
the long work — you do not prepare a review inside a 3×2 grid tile).

- **Card:** a one-line quick-add ("What went well?") that creates an entry with today's date and nothing
  else required; the last N entries with their project/skill/impact chips; a period counter ("14 wins
  this half"); quick actions "Add win" (focuses the input) and "Export" (opens the export sheet).
- **Expand-on-demand:** the quick-add row expands to the full form (impact type, project, skills, links,
  body) via a "Add detail" disclosure. Friction is the enemy of the habit — the entry must be
  _creatable_ in five seconds and _improvable_ later, which is why this widget has a PATCH endpoint
  where mood (ADR-009) deliberately does not: a mood check-in is an immutable event; a win is a draft
  you sharpen before review season.
- **Route `/work`:** period selector, filters (project / skill / impact type), grouped timeline, and the
  export panel with a live markdown preview.
- `settingsSchema` (zod): `{ recentCount: 3–10 (default 4), defaultPeriodId: uuid|null, projects: string[],
skills: string[], quickAddImpactDefault: ImpactType|null }` — the project/skill vocabularies drive the
  chips in the auto-generated settings panel, exactly as ADR-009 does for mood tags.
- Data through generated hooks (`packages/contracts`); optimistic add/delete with the shared undo
  pattern (ADR-008).

### Backend

A dedicated `WorkTrackerModule` (`apps/api/src/work-tracker/`: controller → service → repository), the
same four-file shape as `AppreciationModule` (ADR-017) and `MoodModule`. No cross-module imports; it
emits `work.entry_added { userId, entryId, occurredOn }` on the event bus so `AutomationModule` can run
a "log this week's wins?" Friday nudge and skip it when entries already exist — Automation subscribes,
neither module imports the other (§4.1).

Markdown export is **rendered server-side** (`GET /work/export?format=md`): the grouping, ordering and
heading structure are the product, they must be identical on every device, and they are trivially
unit-testable as a pure function of the rows. The client's job is to display and copy it.

### Data model

Postgres, owned solely by `WorkTrackerModule`, RLS `user_id = auth.uid()` on both tables:

```sql
create type work_impact as enum ('shipped','fixed','improved','mentored','influenced','learned');

create table work_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id),
  title       text not null check (char_length(title) between 1 and 200),
  body        text check (char_length(body) <= 4000),      -- plain text, never rendered as markup
  occurred_on date not null default current_date,          -- date, not timestamptz: "when it happened"
  impact      work_impact,                                 -- nullable: quick-add must not demand it
  projects    text[] not null default '{}',
  skills      text[] not null default '{}',
  links       jsonb  not null default '[]',                -- [{ label, url }] — zod-validated, http(s) only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on work_entries (user_id, occurred_on desc);
create index on work_entries using gin (projects);
create index on work_entries using gin (skills);

create table review_periods (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id),
  name      text not null,                                  -- "H1 2026"
  starts_on date not null,
  ends_on   date not null check (ends_on >= starts_on)
);
```

**Why Postgres, not Mongo (§4.3).** The body is the _least_ important field: an entry is mostly
structured metadata (a date, an enum, two tag arrays, links), and every query the widget exists to serve
is relational — entries within a period, grouped by impact, filtered by project, counted per skill. That
is index-friendly SQL, and it is precisely the "queried with filters and aggregations" column of the
split. Postgres also gives RLS as the second authorisation net (§5.1), which for this dataset is worth
more than for any other. Journal is Mongo because it is rich-text ProseMirror documents with Atlas
full-text search over prose (ADR-016) — neither is true here, and a 4 000-character plain-text field is
not a document, it's a column. The same reasoning ADR-017 used for appreciation, one size up.

**`occurred_on` is a `date`, not a `timestamptz`** — deliberately, and for the reason ADR-018 gives for
all-day calendar events: "the day I shipped it" is a calendar fact, not an instant, and storing it as an
instant reintroduces the classic timezone-shifted-date bug (an entry logged at 23:30 Helsinki showing up
in the previous day's review period). `created_at` keeps the instant for audit.

**Body is plain text.** No markdown rendering in the app: rendering stored markdown means either a
renderer that emits markup (an injection surface §5.2 exists to avoid) or a structured document model
(ADR-016's machinery, wildly disproportionate here). The export _wraps_ the text into markdown; the app
displays it as pre-wrapped text. Markdown syntax typed into the body survives verbatim into the export,
which is exactly what a user typing `**shipped**` wants.

### API contract

Under `/api/v1/work`, JWT-guarded, zod contracts in `packages/contracts` (ADR-004/007),
reject-unknown-fields on (§5.2); `user_id` always from the token, never the body:

- `GET /entries?periodId=&from=&to=&project=&skill=&impact=&limit=&cursor=` → `{ items, nextCursor }`,
  newest `occurred_on` first. Server-side filtering only — the client never fetches the corpus to filter
  it (the ADR-009 rule about aggregation staying server-side).
- `POST /entries` `{ title, body?, occurredOn?, impact?, projects?, skills?, links? }` → 201. Only
  `title` is required: the quick-add path must be one field. `occurredOn` defaults to the server's
  current date in the user's home timezone (ADR Q1).
- `PATCH /entries/:id` — partial update, bumps `updated_at`. **This module has a PATCH** (see Frontend).
- `DELETE /entries/:id` → 204; hard delete, undo by re-POST (ADR-017's precedent — no `deleted_at`
  filter polluting every query).
- `GET /periods`, `POST /periods`, `PATCH /periods/:id`, `DELETE /periods/:id` — small CRUD;
  overlapping periods are allowed (real review cycles overlap with project cycles).
- `GET /entries/stats?periodId=` → `{ total, byImpact, byProject, bySkill }` — SQL aggregation, used by
  the route's summary and by the export header.
- `GET /export?periodId=&format=md|json` → markdown (grouped by impact type, then chronological, each
  entry as a bullet with its date, links as inline references, projects/skills as a trailing tag line)
  or the raw JSON dump that NFR-7 requires. `Content-Disposition: attachment` with a period-named file.

Error semantics: 400 for shape violations (including a `links[].url` that isn't http(s)); uniform 404 for
missing/foreign/malformed ids; storage faults are opaque 500s. `links` is validated with a strict zod
shape and a length cap (≤ 10) so a link array cannot become a smuggling channel for markup.

### Accessibility

- Entries render as a `<ul>`; each `<li>` exposes the title as its heading, with the date as
  `<time datetime>` and chips as text (never bare colour swatches — impact type is a _word_: "Shipped",
  "Mentored").
- Impact type in the form is a `<select>` (or a radiogroup with roving tabindex — pick-one, and unlike
  ADR-009's mood scale, **selection here does not commit a write**, so the textbook pattern is correct
  and is what we use). This asymmetry with the mood widget is intentional and worth stating: the pattern
  follows the write semantics, not the visual shape.
- Filters are real form controls with visible labels; the active filter set is summarised as text
  ("Showing: H1 2026 · project Checkout · 7 entries") in a polite live region, so filtering announces its
  result instead of silently changing a list.
- Export: the "Copy markdown" button announces "Markdown copied to clipboard" via a polite live region;
  the preview is a `<pre tabindex="0" role="region" aria-label="Markdown preview">` that scrolls inside
  its own container (never the page).
- Delete moves focus to the Undo affordance, and to the next entry (or the input) when Undo expires or is
  used — focus is never dropped to `<body>` (ADR-017's rule).
- All copy through the message catalog; dates via `Intl.DateTimeFormat` (NFR-12). Contrast AA in both
  themes, animations behind `prefers-reduced-motion`.

### UX states & interaction

- **Loading:** skeleton of the quick-add row + `recentCount` lines.
- **Empty:** "Nothing logged yet — what went well this week?" with the input focused-on-action. No
  lecturing about career capital; one line, then get out of the way.
- **Add:** Enter on the quick-add optimistically prepends the entry and clears the field; on failure the
  entry rolls back, **the text is restored into the input** (never lost — ADR-010's loss-proof capture
  rule; a lost win is a lost memory) and an inline `role="alert"` explains.
- **Delete:** optimistic with ~6 s Undo, timeout paused on focus/hover (WCAG 2.2.1, ADR-008).
- **Edit:** inline expand-to-form; save is optimistic with rollback + alert on failure.
- **Privacy rules — hard, not preferences (§5.3, NFR-7):**
  - No third-party analytics or trackers on `/work` routes or the widget, ever (same standing rule as
    mood and journal).
  - Server logs carry entry ids and error codes only — never `title`, `body`, or link URLs (a link URL
    can name an employer's incident tracker).
  - Push/automation payloads are generic ("Time to log this week's wins") — never entry content, which
    would transit vendor push infrastructure (§5.2).
  - **Nothing is ever auto-derived.** We do _not_ silently mine `task.completed` events into work
    entries, even though the event bus makes it trivial. A win is a claim the user is willing to make
    about themselves in a review; a machine-inferred one is noise to be audited, and an app that quietly
    builds a dossier of your work from your task log is not one you'd want to keep using. Promotion is
    always explicit: a completed task offers a "Log as a win" action that **prefills** the form (client-
    side composition through the API, no module import — ADR-010's promote-to-task pattern reused).
  - Export is user-initiated only; there is no scheduled export, no email, no webhook.

## Consequences

- **Ships as:** one migration (two tables, one enum, RLS policies), one API module, one contracts schema
  set, one widget folder + one route. Nothing else in the system changes.
- **Easier:** review season becomes a filter and a copy-paste. Period-scoped aggregation is one SQL
  query; the "what did I even do in Q1" question stops being archaeology, which is the entire premise.
- **Easier:** because it's Postgres, a future "wins × mood" view (was I happier in the months I shipped?)
  is a single-database query — the same argument ADR-017 made for keeping appreciation next to mood.
- **Harder / committed to:** this module owns the app's most professionally sensitive data, so it
  inherits every journal-grade rule (2FA, RLS, no analytics, log hygiene, backup/restore testing under
  NFR-5) and adds the no-auto-derivation rule as a permanent constraint on future "smart" features.
- **Committed to:** a PATCH surface (entries are mutable drafts), plain-text bodies, `date`-typed
  `occurred_on`, and a server-rendered markdown export whose format is now a contract with the user's actual
  review document.
- **Why not merged with the appreciation widget (ADR-017):** they share a _shape_ and nothing else.
  Appreciation is gratitude — external, wellbeing-oriented, deliberately unstructured, 280 characters,
  warm copy, no audience. Work tracking is evidence — self-directed, career-oriented, necessarily
  structured (impact type, project, skill, links, period), and its whole value is an export aimed at a
  reader who will judge you. Merging them would force one table to carry two semantics, put a
  performance-review metadata form inside a gratitude practice (which would quietly kill the gratitude
  practice), and give one error boundary to two unrelated failure domains. The one-owner rule (§4.1/§4.3)
  and ADR-017's own precedent — small modules are cheap here — say two modules.
- **Open questions for the product owner:** (1) Should completed tasks with a `#win` tag offer the promote action
  automatically (a nudge, not an inference) — useful, but it is the thin end of the auto-derivation
  wedge? -> _PO-review:_ yes — offer the promote action on `#win`-tagged completed tasks (a nudge,
  still explicit; no auto-creation). (2) Is a per-entry "visible to manager" flag wanted, so the export can split _my_ honest notes
  from _their_ version — or is that a second dataset pretending to be a flag? -> _PO-review:_ no flag —
  one dataset; entries are written knowing they may be exported, private commentary belongs in journal.
  (3) Should periods be
  seedable from a template ("H1/H2", "quarterly") to avoid the empty-periods cold start? -> _PO-review:_
  yes — seed periods from templates ("H1/H2", "quarterly").

## Alternatives considered

- **Store entries in MongoDB alongside journal.** The intuitive call ("it has a body, journal has a
  body"). Rejected: the body is incidental and plain; the queries are relational (period, project,
  skill, impact counts) and would become hand-rolled aggregation pipelines in Mongo; and we would lose
  RLS as the second net on the single dataset where a leak is most damaging. §4.3 splits on shape and
  query, and both point at Postgres.
- **Make it a journal entry type / a section of the Journal widget.** Rejected for exactly ADR-017's
  reasons: shared error boundary, no independent settings or export, not removable on its own — and a
  review-evidence log inside a private-reflection surface muddles two very different privacy postures
  (the journal is for nobody; the work tracker is for a document you will hand to someone).
- **Extend the appreciation widget with a "work" tag.** Rejected — see Consequences: one table, two
  semantics, and it would drag structured review metadata into a gratitude card.
- **Rich text (TipTap) for the body.** Rejected: it imports ADR-016's whole editor stack (bundle,
  schema versioning, autosave machinery) to make bullet points that the markdown export would flatten
  anyway. Plain text plus a markdown export is the same output with none of the surface.
- **Markdown rendered in-app.** Rejected: rendering markdown means generating markup, and §5.2's ban on
  injecting stored content into the DOM applies to our own content too (ADR-013 held the same line). The
  export is where markdown belongs — in a file, not in our DOM.
- **Auto-generate entries from `task.completed` events.** Rejected: see the privacy rules. Also a
  quality argument — a task log is a list of things done; a work tracker is a list of things _worth
  telling someone about_, and conflating them produces a review doc nobody can use.
- **Free-form tags (one `tags text[]`) instead of typed projects/skills/impact.** Rejected: the export
  is the product, and a review document is organised by competency and impact. A flat tag array cannot
  tell "React" (a skill) from "Checkout" (a project), so the grouping — the only reason to do this at
  all — would have to be re-derived by hand every review cycle.
- **Client-side markdown generation.** Rejected: the format is a contract with the user's review document
  and must be identical everywhere and testable in isolation; server-side is a pure function over rows,
  covered by unit tests, and it means the JSON and markdown exports can never drift.
