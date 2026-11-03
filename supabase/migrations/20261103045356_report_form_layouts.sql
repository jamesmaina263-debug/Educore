-- Phase 7.7 (1/2): report form designer storage. Additive only; ships dark.
--
-- * New flag feature.reports.custom_forms (catalog entry, enabled for nobody). It will also gate the custom
--   report builder (WP 7.7 part 2, which needs no database objects of its own).
-- * New table report_form_layouts: ONE row per school holding the wording a school may change on the printed
--   report card (title, subtitle/motto, footer note, and the three signature labels). A NULL column means
--   "use EduCore's default wording", so a school with no row, or the flag off, prints exactly as before.
-- * RLS: any member of the school can read its own row while the flag is on (parents and learners need it to
--   see their card the way the school designed it). There are NO write policies: the only way to change it is
--   save_report_form_layout(), which checks exams.write, the flag and the lengths itself.
-- * Nothing existing is touched: schools.report_settings, update_report_settings() and every existing
--   function, policy, trigger and grant are unchanged. Nothing here sends messages or touches payments.
-- Rollback: switch the flag off (reads return nothing, the function refuses). Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.reports.custom_forms',
       'Custom report forms and report builder',
       'Lets a school change the wording on printed report cards (title, motto, footer, signature labels) and build simple CSV reports. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.reports.custom_forms'
);

-- 2. One layout row per school. NULL = default wording.
create table if not exists public.report_form_layouts (
  school_id uuid primary key references public.schools(id) on delete cascade,
  title text check (title is null or char_length(title) between 1 and 60),
  subtitle text check (subtitle is null or char_length(subtitle) between 1 and 120),
  footer_note text check (footer_note is null or char_length(footer_note) between 1 and 300),
  class_teacher_label text check (class_teacher_label is null or char_length(class_teacher_label) between 1 and 40),
  head_teacher_label text check (head_teacher_label is null or char_length(head_teacher_label) between 1 and 40),
  parent_label text check (parent_label is null or char_length(parent_label) between 1 and 40),
  updated_by uuid references public.school_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.report_form_layouts is
  'Per-school wording for the printed report card. NULL column = default wording. Written only by save_report_form_layout().';
alter table public.report_form_layouts enable row level security;
drop policy if exists report_form_layouts_select on public.report_form_layouts;
create policy report_form_layouts_select on public.report_form_layouts for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and public.my_school_has_feature_flag('feature.reports.custom_forms'))
  );

-- 3. Save the layout. Every argument is optional: blank or NULL clears that field back to the default wording.
create or replace function public.save_report_form_layout(
  p_title text,
  p_subtitle text,
  p_footer_note text,
  p_class_teacher_label text,
  p_head_teacher_label text,
  p_parent_label text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_subtitle text := nullif(btrim(coalesce(p_subtitle, '')), '');
  v_footer text := nullif(btrim(coalesce(p_footer_note, '')), '');
  v_ct text := nullif(btrim(coalesce(p_class_teacher_label, '')), '');
  v_head text := nullif(btrim(coalesce(p_head_teacher_label, '')), '');
  v_parent text := nullif(btrim(coalesce(p_parent_label, '')), '');
begin
  if v_school is null or not auth_has_permission('exams.write') then
    raise exception 'Not authorized to change the report form.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.reports.custom_forms') then
    raise exception 'Custom report forms are not enabled for this school.' using errcode = '55000';
  end if;
  if (v_title is not null and char_length(v_title) > 60)
     or (v_subtitle is not null and char_length(v_subtitle) > 120)
     or (v_footer is not null and char_length(v_footer) > 300)
     or (v_ct is not null and char_length(v_ct) > 40)
     or (v_head is not null and char_length(v_head) > 40)
     or (v_parent is not null and char_length(v_parent) > 40) then
    raise exception 'A report form field is too long.' using errcode = '22023';
  end if;
  -- No control characters anywhere (a footer may use plain spaces only; line breaks are not supported).
  if coalesce(v_title, '') ~ '[[:cntrl:]]' or coalesce(v_subtitle, '') ~ '[[:cntrl:]]'
     or coalesce(v_footer, '') ~ '[[:cntrl:]]' or coalesce(v_ct, '') ~ '[[:cntrl:]]'
     or coalesce(v_head, '') ~ '[[:cntrl:]]' or coalesce(v_parent, '') ~ '[[:cntrl:]]' then
    raise exception 'A report form field contains invalid characters.' using errcode = '22023';
  end if;

  insert into public.report_form_layouts
    (school_id, title, subtitle, footer_note, class_teacher_label, head_teacher_label, parent_label, updated_by, updated_at)
  values
    (v_school, v_title, v_subtitle, v_footer, v_ct, v_head, v_parent, v_me, now())
  on conflict (school_id) do update
    set title = excluded.title, subtitle = excluded.subtitle, footer_note = excluded.footer_note,
        class_teacher_label = excluded.class_teacher_label, head_teacher_label = excluded.head_teacher_label,
        parent_label = excluded.parent_label, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.save_report_form_layout(text, text, text, text, text, text) from public, anon;
grant execute on function public.save_report_form_layout(text, text, text, text, text, text) to authenticated;
