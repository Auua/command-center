-- 0005_automations.sql
-- Automations + their run log (ADR §4.4, ADR-015/039; owner: AutomationModule,
-- runs written by the Phase-2 scheduler via the service-role carve-out).
--
-- kind is 'recurring' | 'event' (CHECK below); 'time' from the original §4.4
-- sketch is reserved, not accepted — ADR-015's builder only produces the two.
-- CHECK constraints make illegal states unrepresentable: an event automation
-- carries exactly an event_key; a recurring one carries exactly a schedule
-- descriptor (the edit-UI source of truth) plus its server-compiled cron_expr.
-- cron_expr is never user input — the API compiles it from schedule (ADR-015).

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('recurring', 'event')),
  schedule jsonb,
  cron_expr text,
  event_key text,
  action jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_event_shape
    check ((kind = 'event') = (event_key is not null)),
  constraint automations_recurring_shape
    check ((kind = 'recurring') = (cron_expr is not null and schedule is not null))
);

comment on table public.automations is
  'User-defined reminders: recurring (schedule jsonb -> compiled cron_expr) or event-triggered; action is notify-only in v1 (owner: AutomationModule).';

-- List/due query shape: a user''s automations, filtered on enabled.
create index if not exists automations_user_id_idx
  on public.automations (user_id);

-- Keep updated_at fresh on row updates (function created in 0001).
drop trigger if exists automations_set_updated_at on public.automations;
create trigger automations_set_updated_at
  before update on public.automations
  for each row
  execute function public.set_updated_at();

alter table public.automations enable row level security;

drop policy if exists "automations_select_own" on public.automations;
create policy "automations_select_own"
  on public.automations
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "automations_insert_own" on public.automations;
create policy "automations_insert_own"
  on public.automations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "automations_update_own" on public.automations;
create policy "automations_update_own"
  on public.automations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "automations_delete_own" on public.automations;
create policy "automations_delete_own"
  on public.automations
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Run log: one row per occurrence slot. UNIQUE (automation_id, slot) is
-- NFR-3's idempotent dedupe made structural — the scheduler claims a slot by
-- inserting 'pending' with ON CONFLICT DO NOTHING (ADR-039), so overlapping
-- ticks can never double-notify. slot is a UTC instant, so DST is unambiguous.
-- user_id is denormalized from automations for direct RLS + the today query.

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  slot timestamptz not null,
  fired_at timestamptz,
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  constraint automation_runs_slot_unique unique (automation_id, slot)
);

comment on table public.automation_runs is
  'Engine outcome per occurrence slot: pending (claimed, internal-transient) -> sent | failed; out-of-window slots recorded skipped (ADR-039).';

-- Today-endpoint query shape: a user''s runs inside the local-day window.
create index if not exists automation_runs_user_id_slot_idx
  on public.automation_runs (user_id, slot);

-- Recent-activity query shape: latest runs of one automation.
create index if not exists automation_runs_automation_id_slot_idx
  on public.automation_runs (automation_id, slot desc);

-- Row Level Security: select-own only — every write goes through the
-- scheduler's service-role path (ADR-039); clients never insert or edit runs.
alter table public.automation_runs enable row level security;

drop policy if exists "automation_runs_select_own" on public.automation_runs;
create policy "automation_runs_select_own"
  on public.automation_runs
  for select
  to authenticated
  using (auth.uid() = user_id);
