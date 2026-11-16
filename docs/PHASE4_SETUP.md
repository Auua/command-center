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

- [ ] The Appreciations card shows the day's prompt as its placeholder; after the first entry
      of the day it reads "One small good thing…".
- [ ] Enter adds a line instantly; deleting one shows Undo, and Undo brings it back.
- [ ] An existing dashboard gets the card through **Edit layout → Add widget → Appreciations**
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

- [ ] The Journal card shows today's prompt and "Write today's entry"; the button opens
      `/journal/new` with the prompt above the editor.
- [ ] Typing saves on its own ("Saving…" → "Saved"); the address changes to `/journal/<id>`
      after the first save without the caret jumping.
- [ ] With the network off (DevTools → Offline), typing continues and the status reads "Saving
      locally — will sync"; back online, it saves.
- [ ] Reloading mid-sentence while offline brings the text back.
- [ ] Back on the dashboard the card reads "Edit today's entry" with the preview, and focus is on
      that button.
- [ ] `/journal` lists the entry; Export downloads a JSON file with `markdown` per entry.
- [ ] Delete asks first, and the entry is gone from the timeline.
- [ ] Existing dashboards get the card through **Edit layout → Add widget → Journal**.

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

- [ ] `journal_search` shows **Ready** in Atlas.
- [ ] On `/journal`, searching a word from an entry lists it with the word highlighted; the
      address becomes `/journal?q=…`.
- [ ] Two words find only entries that contain both; a tag name finds entries with that tag.
- [ ] Search with a date range or a tag narrows the results; **Clear** returns to the timeline.
- [ ] Opening a result and going back returns to the same search.
- [ ] A word that appears nowhere says "No entries contain …".
