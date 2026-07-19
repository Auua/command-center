-- 0006_notifications.sql
-- Web Push subscriptions + the in-app notification bell (ADR §4.4, ADR-039;
-- owner: NotificationModule).
--
-- push_subscriptions: one row per browser push endpoint. Endpoints are
-- unguessable capability URLs — never logged in full by the API — and the
-- contract layer only accepts HTTPS endpoints on known browser push-service
-- hosts (SSRF closed at registration, ADR-039).
--
-- notifications: the bell is its own table, not a view over automation_runs —
-- runs are engine outcomes, not inbox items, and future sources (calendar
-- sync errors, Anki failures) are not automations. The bell row is the
-- delivery of record (ADR-039): it exists whether or not any push succeeded.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 1024),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth text not null check (char_length(auth) between 1 and 256),
  user_agent text check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  constraint push_subscriptions_user_endpoint_unique unique (user_id, endpoint)
);

comment on table public.push_subscriptions is
  'Browser Web Push subscriptions; endpoint is a capability URL, pruned on 404/410 from the push service (owner: NotificationModule).';

-- Row Level Security: the user registers/removes their own subscriptions;
-- there is no update path (a rotated subscription is a new endpoint row).
-- The scheduler reads + prunes via the service-role carve-out (ADR-039).
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text check (char_length(body) <= 200),
  source text not null default 'automation' check (char_length(source) between 1 and 40),
  automation_id uuid references public.automations (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.notifications is
  'In-app notification bell — the delivery of record for every automation fire, regardless of push outcome (ADR-039; owner: NotificationModule).';

-- Bell list query shape: newest first for one user.
create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

-- Unread badge count: partial index keeps it O(unread).
create index if not exists notifications_user_id_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- Row Level Security: select + update (mark-read) own; no insert/delete
-- policies — rows are written only by the service-role dispatch path.
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
