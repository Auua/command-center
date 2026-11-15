-- 0012_appreciation.sql
-- Appreciation tracker (ADR-017, owner: AppreciationModule): one short line
-- per entry, optionally tagged, plus the seeded daily prompts.
--
-- Same posture as 0003 (mood): RLS on with auth.uid() = user_id policies;
-- the API uses the RLS-respecting anon role + the user's JWT, never
-- service_role. Entries are immutable one-liners — no PATCH, so no update
-- policy, no updated_at column. Idempotent: safe to run twice.

-- Tags: at most 5, each 1–24 characters — the contract's limits, enforced
-- here too so the database never holds what the API would reject.
create or replace function public.appreciation_tags_valid(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(tags) <= 5
     and coalesce(bool_and(char_length(tag) between 1 and 24), true)
  from unnest(tags) as tag
$$;

create table if not exists public.appreciation_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 280),
  tags text[] not null default '{}' check (public.appreciation_tags_valid(tags)),
  created_at timestamptz not null default now()
);

comment on table public.appreciation_entries is
  'Per-user appreciation one-liners (1–280 chars, up to 5 tags) — owner: AppreciationModule (ADR-017).';

-- List query shape: a user''s most recent entries, newest first.
create index if not exists appreciation_entries_user_id_created_at_idx
  on public.appreciation_entries (user_id, created_at desc);

alter table public.appreciation_entries enable row level security;

drop policy if exists "appreciation_entries_select_own" on public.appreciation_entries;
create policy "appreciation_entries_select_own"
  on public.appreciation_entries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "appreciation_entries_insert_own" on public.appreciation_entries;
create policy "appreciation_entries_insert_own"
  on public.appreciation_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "appreciation_entries_delete_own" on public.appreciation_entries;
create policy "appreciation_entries_delete_own"
  on public.appreciation_entries
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Daily prompts: seeded reference data, not user data. Text is per locale
-- (NFR-12) with English required. Readable by any signed-in user; there is
-- no write policy, so only migrations (or the SQL editor) change them.
create table if not exists public.appreciation_prompts (
  id text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  text jsonb not null check (
    jsonb_typeof(text) = 'object'
    and text ? 'en'
    and char_length(text ->> 'en') between 1 and 200
  ),
  active boolean not null default true
);

comment on table public.appreciation_prompts is
  'Seeded daily prompts for the appreciation widget, text per locale ({"en": …}) — owner: AppreciationModule (ADR-017).';

alter table public.appreciation_prompts enable row level security;

drop policy if exists "appreciation_prompts_select_authenticated" on public.appreciation_prompts;
create policy "appreciation_prompts_select_authenticated"
  on public.appreciation_prompts
  for select
  to authenticated
  using (true);

-- `on conflict do nothing`: re-running the migration never overwrites a
-- prompt edited (or deactivated) by hand in the SQL editor.
insert into public.appreciation_prompts (id, text) values
  ('smile', '{"en": "What made you smile today?"}'),
  ('small-win', '{"en": "What small thing went right today?"}'),
  ('someone', '{"en": "Who made your day a little easier?"}'),
  ('noticed', '{"en": "What did you notice today that you usually walk past?"}'),
  ('comfort', '{"en": "What felt comfortable or cosy today?"}'),
  ('learned', '{"en": "What did you learn today, however small?"}'),
  ('body', '{"en": "What is your body doing well for you today?"}'),
  ('taste', '{"en": "What tasted good today?"}'),
  ('outside', '{"en": "What was good about the world outside today?"}'),
  ('past-self', '{"en": "What did past-you do that present-you is glad about?"}'),
  ('sound', '{"en": "What sound, song or silence did you enjoy today?"}'),
  ('looking-forward', '{"en": "What are you quietly looking forward to?"}')
on conflict (id) do nothing;
