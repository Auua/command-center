-- 0013_calendar_events.sql
-- Calendar (ADR-018, owner: CalendarModule): the user's own events and
-- recurring series. Occurrences are never stored — the API expands each
-- series' RRULE per request.
--
-- Same posture as 0012: RLS on with auth.uid() = user_id policies; the API
-- uses the RLS-respecting anon role + the user's JWT, never service_role.
-- Idempotent: safe to run twice.

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  -- Timed events: an instant pair, rendered in the home timezone.
  starts_at timestamptz,
  ends_at timestamptz,
  -- All-day events: plain dates, inclusive — never a timestamp, so a
  -- birthday can never shift a day when the timezone changes.
  starts_on date,
  ends_on date,
  all_day boolean not null default false,
  -- RFC 5545 RRULE without DTSTART (the start columns are the series start).
  rrule text check (rrule is null or char_length(rrule) between 1 and 300),
  -- Skipped occurrences, by occurrence key: an ISO instant (timed) or a
  -- YYYY-MM-DD date (all-day).
  exdates text[] not null default '{}' check (cardinality(exdates) <= 1000),
  -- The IANA zone a timed series repeats in: its wall-clock time stays put
  -- across DST and across a change of home timezone.
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  location text check (location is null or char_length(location) <= 200),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one representation is populated.
  constraint calendar_events_timing check (
    (all_day
      and starts_on is not null and ends_on is not null and ends_on >= starts_on
      and starts_at is null and ends_at is null)
    or (not all_day
      and starts_at is not null and ends_at is not null and ends_at > starts_at
      and starts_on is null and ends_on is null)
  )
);

comment on table public.calendar_events is
  'Per-user calendar events and recurring series (RRULE, expanded by the API) — owner: CalendarModule (ADR-018).';

-- Range scans: timed and all-day events by start.
create index if not exists calendar_events_user_starts_at_idx
  on public.calendar_events (user_id, starts_at) where not all_day;
create index if not exists calendar_events_user_starts_on_idx
  on public.calendar_events (user_id, starts_on) where all_day;

alter table public.calendar_events enable row level security;

drop policy if exists "calendar_events_select_own" on public.calendar_events;
create policy "calendar_events_select_own"
  on public.calendar_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "calendar_events_insert_own" on public.calendar_events;
create policy "calendar_events_insert_own"
  on public.calendar_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "calendar_events_update_own" on public.calendar_events;
create policy "calendar_events_update_own"
  on public.calendar_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "calendar_events_delete_own" on public.calendar_events;
create policy "calendar_events_delete_own"
  on public.calendar_events
  for delete
  to authenticated
  using (auth.uid() = user_id);
