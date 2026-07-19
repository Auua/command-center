-- 0004_user_profiles.sql
-- Per-user profile: the stored home IANA timezone (ADR §4.4, Q1; owner:
-- ProfileModule). Phase 2's schedule evaluator and the today endpoint both
-- expand cron expressions in this timezone — no timezone is ever inferred
-- server-side from requests.
-- Same posture as 0001-0003: RLS on with auth.uid() = user_id policies; the
-- user-facing API path uses the RLS-respecting anon role + the user's JWT.
-- (The Phase-2 scheduler reads this table via the service-role carve-out,
-- ADR-039 — service_role bypasses RLS by design.)

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Per-user settings: home IANA timezone for schedule evaluation (owner: ProfileModule).';

-- Keep updated_at fresh on row updates (function created in 0001).
drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row
  execute function public.set_updated_at();

-- Row Level Security: user-scoped access only (NFR-6). No delete policy —
-- a profile row lives and dies with the auth.users row (cascade).
alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own"
  on public.user_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own"
  on public.user_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
  on public.user_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
