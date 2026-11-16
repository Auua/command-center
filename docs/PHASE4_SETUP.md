# Phase 4 — one-time external setup

What the Phase 4 steps need outside this repo, in the order the steps land. Pair with
`docs/plans/phase4-reflection.md`. Earlier phases: `docs/PHASE2_SETUP.md`, `docs/PHASE3_SETUP.md`.

## 4A — Layout editor (ADR-042)

Nothing: no migration, no environment variable.

## 4B — Appreciation (ADR-017)

### 1. Supabase migration

SQL editor → run `supabase/migrations/0012_appreciation.sql` (idempotent; safe to run twice).
It creates `appreciation_entries` (own-row RLS for select / insert / delete), the
`appreciation_tags_valid` check function, and `appreciation_prompts` (readable by any signed-in
user, no write policy) with twelve seeded English prompts.

Checks:

```sql
select count(*) from public.appreciation_prompts where active;   -- 12
select * from public.appreciation_entries;                       -- empty set, not an error
```

Until the migration runs, the widget shows "Couldn't load appreciations." and every other
widget is unaffected.

### 2. Editing the prompts (optional, any time)

Prompts are data, not code (ADR-017): edit them in the SQL editor, no deploy. Re-running the
migration never overwrites an edited prompt (`on conflict do nothing`).

```sql
-- add one
insert into public.appreciation_prompts (id, text)
values ('kind-words', '{"en": "What kind words did you hear or say today?"}');
-- retire one without deleting it
update public.appreciation_prompts set active = false where id = 'taste';
-- add a Finnish text to an existing prompt (falls back to English when missing)
update public.appreciation_prompts
set text = text || '{"fi": "Mikä sai sinut hymyilemään tänään?"}'
where id = 'smile';
```

### 3. Manual checklist

- [x] The Appreciations card shows the day's prompt as its placeholder; after the first entry
      of the day it reads "One small good thing…".
- [x] Enter adds a line instantly; deleting one shows Undo, and Undo brings it back.
- [x] An existing dashboard gets the card through **Edit layout → Add widget → Appreciations**
      (the default layout includes it for new users).

## 4C — Journal (ADR-016)

Nothing to run: entries live in MongoDB (the same `MONGODB_CONNECT` as braindump), the
collections and indexes are created on first use, and the 16 prompts in `journal_prompts` are
seeded when the API boots. Search (4C-2) adds an Atlas Search index — see below.

### Editing prompts

In Atlas → Browse Collections → `journal_prompts`. A prompt is
`{ _id: "slug", text: { en: "…" }, category: "reflect" | "gratitude" | "growth" | "feelings", active: true }`.
Set `active: false` to retire one; edits are never overwritten by the boot-time seed (it only
inserts missing ids).

### Manual checklist

- [x] The Journal card shows today's prompt and "Write today's entry"; the button opens
      `/journal/new` with the prompt above the editor.
- [x] Typing saves on its own ("Saving…" → "Saved"); the address changes to `/journal/<id>`
      after the first save without the caret jumping.
- [x] With the network off (DevTools → Offline), typing continues and the status reads "Saving
      locally — will sync"; back online, it saves.
- [x] Reloading mid-sentence while offline brings the text back.
- [x] Back on the dashboard the card reads "Edit today's entry" with the preview, and focus is on
      that button.
- [x] `/journal` lists the entry; Export downloads a JSON file with `markdown` per entry.
- [x] Delete asks first, and the entry is gone from the timeline.
- [x] Existing dashboards get the card through **Edit layout → Add widget → Journal**.

## 4C-2 — Journal search (ADR-016)

Nothing to run either: the API creates the Atlas Search index `journal_search` on
`journal_entries` when it boots (and again on a search, while it is missing). Atlas then builds
it in the background — a minute or two for a small journal. Until it is ready, search answers
503 and `/journal` says "Search isn't ready yet".

To confirm, in Atlas → the cluster → **Search & Vector Search**: `journal_search` on
`journal_entries` shows **Ready**. A free (M0) cluster allows three search indexes; this is the
first.

**If it is not there** — the API log says `Journal search unavailable …` (for example the
database user lacks `readWrite`) — create it by hand: Create Search Index → JSON editor →
database from `MONGODB_CONNECT`, collection `journal_entries`, name `journal_search`, definition:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "_id": { "type": "objectId" },
      "userId": { "type": "token" },
      "entryDate": { "type": "token" },
      "plainText": { "type": "string", "analyzer": "lucene.standard" },
      "tags": [{ "type": "token" }, { "type": "string", "analyzer": "lucene.standard" }]
    }
  }
}
```

The code is the source of truth for this definition (`apps/api/src/journal/search.ts`); the API
never changes an index that exists, so a later definition change is applied here by hand.

### Manual checklist

- [x] `journal_search` shows **Ready** in Atlas.
- [x] On `/journal`, searching a word from an entry lists it with the word highlighted; the
      address becomes `/journal?q=…`.
- [x] Two words find only entries that contain both; a tag name finds entries with that tag.
- [x] Search with a date range or a tag narrows the results; **Clear** returns to the timeline.
- [ ] Opening a result and going back returns to the same search — with the browser's Back and
      with the editor's **← Journal** button.
- [x] A word that appears nowhere says "No entries contain …".

## 4D — Calendar (ADR-018)

### 1. Run migration 0013

In Supabase → SQL editor, run `supabase/migrations/0013_calendar_events.sql` (idempotent — safe to
run twice). It creates `calendar_events` with own-row RLS. Until it is run, the Calendar card and
`/calendar` show "Couldn't load the calendar."

### 2. Manual checklist

- [ ] The header shows **Calendar** next to Journal; existing dashboards get the card through
      **Edit layout → Add widget → Calendar** (the default layout includes it for new users).
- [ ] **New event** (card or page) opens the dialog at the next whole hour, an hour long; saving
      shows it in the card and on `/calendar`.
- [ ] A weekly event at 09:00 created before 29 March (or 25 October) is still at 09:00 the week
      after the clocks change.
- [ ] An all-day event (e.g. a birthday, repeating every year) sits on its date in Agenda and Month.
- [ ] Month view: arrow keys move between days, Page Up/Down change month, Enter opens the day's
      list; typing a letter on a day opens a new event with that letter as its title.
- [ ] Deleting a repeating event asks **Only this one / The whole series**; Undo brings it back;
      left alone for 5 s, it stays gone after a reload.
- [ ] With **Show task deadlines** on (card settings), an open task with a deadline appears as
      "Task due" on its day.
