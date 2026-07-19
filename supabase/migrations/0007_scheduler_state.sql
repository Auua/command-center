-- 0007_scheduler_state.sql
-- Scheduler high-water mark (ADR-039; owner: SchedulerModule via the
-- service-role carve-out). One row per scheduler ('automation-tick');
-- cursor_at is the exclusive start of the next tick's evaluation window,
-- last_tick_at feeds /health tick-staleness (NFR-10).

create table if not exists public.scheduler_state (
  name text primary key,
  cursor_at timestamptz not null,
  last_tick_at timestamptz,
  details jsonb
);

comment on table public.scheduler_state is
  'Tick cursor per scheduler (row ''automation-tick''): high-water mark + last tick stamp (ADR-039).';

-- Row Level Security: enabled with NO policies — this table is internal to
-- the service-role scheduler path; authenticated clients see nothing.
alter table public.scheduler_state enable row level security;
