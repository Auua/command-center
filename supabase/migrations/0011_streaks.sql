-- 0011_streaks.sql
-- Streaks (ADR-014): read model + per-day marks. Written by StreaksService
-- inside the request that emitted the source event, under that request's
-- JWT (no service-role path) — hence own-row insert/update policies.

create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  widget_id text not null check (char_length(widget_id) between 1 and 60),
  current_len integer not null default 0 check (current_len >= 0),
  best_len integer not null default 0 check (best_len >= 0),
  last_active_date date,
  updated_at timestamptz not null default now(),
  unique (user_id, widget_id)
);

comment on table public.streaks is
  'Per-user, per-source streak read model (ADR-014; owner: LearningModule/StreaksService). Rollover is computed on read.';

drop trigger if exists streaks_set_updated_at on public.streaks;
create trigger streaks_set_updated_at
  before update on public.streaks
  for each row
  execute function public.set_updated_at();

create table if not exists public.streak_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  streak_key text not null,
  local_date date not null,
  primary key (user_id, streak_key, local_date)
);

comment on table public.streak_days is
  'One row per (user, streak, home-timezone day with 03:00 grace) — idempotent marks behind the 7-day dots (ADR-014).';

alter table public.streaks enable row level security;
alter table public.streak_days enable row level security;

drop policy if exists "streaks_select_own" on public.streaks;
create policy "streaks_select_own" on public.streaks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "streaks_insert_own" on public.streaks;
create policy "streaks_insert_own" on public.streaks
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "streaks_update_own" on public.streaks;
create policy "streaks_update_own" on public.streaks
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "streak_days_select_own" on public.streak_days;
create policy "streak_days_select_own" on public.streak_days
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "streak_days_insert_own" on public.streak_days;
create policy "streak_days_insert_own" on public.streak_days
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "streak_days_delete_own" on public.streak_days;
create policy "streak_days_delete_own" on public.streak_days
  for delete to authenticated using (auth.uid() = user_id);
