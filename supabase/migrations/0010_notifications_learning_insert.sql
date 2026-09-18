-- 0010_notifications_learning_insert.sql
-- ADR-040: learning-side failures (stale/missing index, expired vault token)
-- surface in the bell as rows with source = 'learning'. They are observed on
-- an ordinary user request, so they are written under the caller's own JWT
-- through RLS — no service-role path. Automation rows keep coming only from
-- the scheduler's carve-out (no policy for that source).

drop policy if exists "notifications_insert_own_learning" on public.notifications;
create policy "notifications_insert_own_learning"
  on public.notifications
  for insert
  to authenticated
  with check (auth.uid() = user_id and source = 'learning' and automation_id is null);
