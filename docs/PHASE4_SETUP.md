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
