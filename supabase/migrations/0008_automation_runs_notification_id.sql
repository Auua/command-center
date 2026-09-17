-- 0008_automation_runs_notification_id.sql
-- Retry-safe bell writes (ADR-039 amendment, 2026-09-17; owner: SchedulerModule).
--
-- The dispatch tail writes the bell row, then pushes, then writes the run
-- status. A crash between the bell insert and the status write leaves the
-- run `pending`; the next tick's stale sweep re-runs dispatch. Without a
-- record of the bell row already written, that retry inserted a second
-- notification for the same slot (push is deduped by the OS tag; the bell
-- was not). The dispatcher now stamps the bell row's id on the run right
-- after the insert and skips the insert on retry when it is already set.

alter table public.automation_runs
  add column if not exists notification_id uuid references public.notifications (id) on delete set null;

comment on column public.automation_runs.notification_id is
  'Bell row written for this run; set immediately after the insert so a stale-pending retry reuses it (ADR-039).';
