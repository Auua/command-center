-- 0009_widget_layouts_instance_key.sql
-- Per-instance widgets (ADR-013: one definition instantiated per track).
-- `widget_id` stays the registry lookup key; `instance_key` distinguishes
-- several placements of the same definition ('' for the single-instance
-- case, so every existing row is unchanged and stays unique).

alter table public.widget_layouts
  add column if not exists instance_key text not null default '';

alter table public.widget_layouts
  drop constraint if exists widget_layouts_user_id_widget_id_key;

alter table public.widget_layouts
  drop constraint if exists widget_layouts_user_id_widget_id_instance_key_key;

alter table public.widget_layouts
  add constraint widget_layouts_user_id_widget_id_instance_key_key
  unique (user_id, widget_id, instance_key);

comment on column public.widget_layouts.instance_key is
  'Distinguishes several placements of one widget definition (e.g. tech-lesson per track); empty for single-instance widgets.';
