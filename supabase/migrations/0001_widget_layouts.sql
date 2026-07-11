-- 0001_widget_layouts.sql
-- Widget layout persistence for the dashboard shell (ARD §4.2, §4.4).
-- RLS on with auth.uid() = user_id policies (ARD §5.1, NFR-6): the API
-- connects with the RLS-respecting anon role + the user's JWT, never
-- service_role.

create table if not exists public.widget_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  widget_id text not null,
  grid_pos jsonb not null,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, widget_id)
);

comment on table public.widget_layouts is
  'Per-user dashboard widget layout: grid position + per-widget settings (owner: WidgetRegistryModule).';

-- Keep updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists widget_layouts_set_updated_at on public.widget_layouts;
create trigger widget_layouts_set_updated_at
  before update on public.widget_layouts
  for each row
  execute function public.set_updated_at();

-- Row Level Security: user-scoped access only (NFR-6).
alter table public.widget_layouts enable row level security;

drop policy if exists "widget_layouts_select_own" on public.widget_layouts;
create policy "widget_layouts_select_own"
  on public.widget_layouts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "widget_layouts_insert_own" on public.widget_layouts;
create policy "widget_layouts_insert_own"
  on public.widget_layouts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "widget_layouts_update_own" on public.widget_layouts;
create policy "widget_layouts_update_own"
  on public.widget_layouts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "widget_layouts_delete_own" on public.widget_layouts;
create policy "widget_layouts_delete_own"
  on public.widget_layouts
  for delete
  to authenticated
  using (auth.uid() = user_id);
