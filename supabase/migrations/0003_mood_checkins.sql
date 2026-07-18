-- 0003_mood_checkins.sql
-- Mood check-ins: 1-5 score with optional tags and note (ADR §4.4, owner:
-- MoodModule). Same posture as 0001/0002: RLS on with auth.uid() = user_id
-- policies; the API uses the RLS-respecting anon role + the user's JWT,
-- never service_role.
--
-- Check-ins are immutable (log a new one to change your mind; delete to
-- undo), so there is no updated_at column or touch trigger.

create table if not exists public.mood_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mood_score int not null check (mood_score between 1 and 5),
  tags text[] not null default '{}',
  note text check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.mood_checkins is
  'Per-user mood check-ins: score 1 (rough) to 5 (great), tags, optional note (owner: MoodModule).';

-- List query shape: a user''s check-ins within a recent time window,
-- newest first (trend + "today" both derive from this).
create index if not exists mood_checkins_user_id_created_at_idx
  on public.mood_checkins (user_id, created_at desc);

-- Row Level Security: user-scoped access only (NFR-6).
alter table public.mood_checkins enable row level security;

drop policy if exists "mood_checkins_select_own" on public.mood_checkins;
create policy "mood_checkins_select_own"
  on public.mood_checkins
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "mood_checkins_insert_own" on public.mood_checkins;
create policy "mood_checkins_insert_own"
  on public.mood_checkins
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "mood_checkins_delete_own" on public.mood_checkins;
create policy "mood_checkins_delete_own"
  on public.mood_checkins
  for delete
  to authenticated
  using (auth.uid() = user_id);
