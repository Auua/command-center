-- 0002_tasks.sql
-- Tasks: todos with priority, tags, deadline (ARD §4.4, owner: TasksModule).
-- Same posture as 0001: RLS on with auth.uid() = user_id policies; the API
-- uses the RLS-respecting anon role + the user's JWT, never service_role.
--
-- Tags live in a text[] column rather than the task_tags join table the
-- original ERD sketched: PostgREST offers no multi-table transactions, tags
-- are only ever read with their task, and mood_checkins already set the
-- text[] precedent. The ARD ERD has been updated to match.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  priority int check (priority between 1 and 3),
  tags text[] not null default '{}',
  deadline date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is
  'Per-user todos: priority 1 (highest) to 3, tags, day-granular deadline (owner: TasksModule).';

-- List query shape: all of a user''s open tasks, then recently completed.
create index if not exists tasks_user_id_completed_at_idx
  on public.tasks (user_id, completed_at);

-- Keep updated_at fresh on row updates (function created in 0001).
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

-- Row Level Security: user-scoped access only (NFR-6).
alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own"
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own"
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
  on public.tasks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
  on public.tasks
  for delete
  to authenticated
  using (auth.uid() = user_id);
