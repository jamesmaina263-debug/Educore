-- Learner progress report: head-teacher comment, term attendance summary, and the settings keys
-- that switch these sections (plus the printed parent acknowledgement) on or off.
--
-- ADDITIVE: one new table, one new permission, two new functions, and a REPLACEMENT of
-- update_report_settings() whose only change is a longer key whitelist. No existing table, column,
-- policy or trigger is altered.
--
-- 1. HEAD-TEACHER COMMENT (report_card_head_comments)
--    Deliberately a SEPARATE table, not a column on report_cards: report_cards_update_own_class lets
--    a class teacher UPDATE any column of their own class's cards, which would let a class teacher
--    write the head teacher's comment. Here there are NO write policies at all; the only way in is
--    set_report_card_head_comment(), which requires the new report_cards.comment_head permission
--    (principal, deputy principal, school owner) and the caller's own school.
--    Read access INHERITS the report card's own rules: the select policy requires that the caller can
--    already see the report card. So staff with exams.read see it, and a parent/student sees it only
--    once the class-teacher comment has been approved/written (the existing "released" rule), never
--    before. No AI is involved: the head teacher writes the comment themselves.
--
-- 2. ATTENDANCE SUMMARY (report_card_attendance_summary)
--    Counts present/absent/late days from student_attendance inside the exam's term dates. It is
--    SECURITY INVOKER, so student_attendance's existing RLS applies unchanged: a caller who cannot read
--    a learner's register gets no row for them, and the report simply omits the attendance section
--    (never a made-up figure). Aggregating in SQL also avoids PostgREST's 1000-row cap on a class
--    print. A learner with no recorded days in the term has no row, so "no data" is never shown as 0%.
--
-- 3. SETTINGS KEYS (update_report_settings)
--    Adds show_attendance (default OFF), show_head_teacher_comment (default ON, nothing prints
--    until a comment exists), show_parent_acknowledgement (default OFF). The new sections that would
--    change what a school's existing report cards look like default to off, so merging changes
--    nothing for any school until an administrator opts in.

insert into role_permissions (role_id, permission_key, allowed)
select id, 'report_cards.comment_head', true
from roles where name in ('principal', 'deputy_principal', 'school_owner');

create table report_card_head_comments (
  report_card_id uuid primary key references report_cards(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  comment text not null check (char_length(btrim(comment)) between 1 and 1000),
  commented_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table report_card_head_comments is
  'Head teacher''s comment on a report card. Written only through set_report_card_head_comment() (report_cards.comment_head). Readable by exactly those who can read the underlying report card, so a parent sees it only after release.';
create index report_card_head_comments_school_id_idx on report_card_head_comments (school_id);
create index report_card_head_comments_commented_by_idx on report_card_head_comments (commented_by);

create trigger trg_report_card_head_comments_updated_at
  before update on report_card_head_comments
  for each row execute function set_updated_at();

alter table report_card_head_comments enable row level security;

create policy report_card_head_comments_select on report_card_head_comments for select to authenticated
  using (
    school_id = (select auth_school_id())
    and exists (select 1 from report_cards rc where rc.id = report_card_head_comments.report_card_id)
  );
-- Intentionally no insert/update/delete policies: direct writes are denied by RLS.

create or replace function public.set_report_card_head_comment(p_report_card_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_card_school uuid;
  v_text text;
begin
  if not public.auth_has_permission('report_cards.comment_head') then
    raise exception 'Not authorized to write the head teacher comment.';
  end if;

  v_school_id := public.auth_school_id();
  select school_id into v_card_school from public.report_cards where id = p_report_card_id;
  if v_school_id is null or v_card_school is null or v_card_school <> v_school_id then
    raise exception 'Report card not found.';
  end if;

  v_text := nullif(btrim(coalesce(p_comment, '')), '');
  if v_text is null then
    delete from public.report_card_head_comments where report_card_id = p_report_card_id;
    return;
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'The head teacher comment is limited to 1000 characters.';
  end if;

  insert into public.report_card_head_comments (report_card_id, school_id, comment, commented_by)
  values (p_report_card_id, v_school_id, v_text, public.auth_school_user_id())
  on conflict (report_card_id) do update
    set comment = excluded.comment, commented_by = excluded.commented_by;
end;
$function$;

revoke all on function public.set_report_card_head_comment(uuid, text) from public, anon;
grant execute on function public.set_report_card_head_comment(uuid, text) to authenticated;

create or replace function public.report_card_attendance_summary(p_exam_id uuid, p_student_ids uuid[])
returns table (student_id uuid, present_days integer, late_days integer, absent_days integer, recorded_days integer)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    sa.student_id,
    (count(*) filter (where sa.status = 'present'))::integer,
    (count(*) filter (where sa.status = 'late'))::integer,
    (count(*) filter (where sa.status = 'absent'))::integer,
    count(*)::integer
  from public.student_attendance sa
  join public.exams e on e.id = p_exam_id
  join public.terms t on t.id = e.term_id
  where sa.student_id = any (p_student_ids)
    and sa.attendance_date between t.start_date and t.end_date
  group by sa.student_id;
$function$;

revoke all on function public.report_card_attendance_summary(uuid, uuid[]) from public, anon;
grant execute on function public.report_card_attendance_summary(uuid, uuid[]) to authenticated;

create or replace function public.update_report_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_key text;
  v_known_keys text[] := array[
    'ranking_enabled', 'show_competency_ratings', 'show_signatures', 'show_class_statistics',
    'show_attendance', 'show_head_teacher_comment', 'show_parent_acknowledgement'
  ];
begin
  if not public.auth_has_permission('exams.write') then
    raise exception 'Not authorized to change report settings.';
  end if;

  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Report settings must be a JSON object.';
  end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if not (v_key = any (v_known_keys)) then
      raise exception 'Unknown report setting: %', v_key;
    end if;
    if jsonb_typeof(p_settings -> v_key) is distinct from 'boolean' then
      raise exception 'Report setting % must be true or false.', v_key;
    end if;
  end loop;

  v_school_id := public.auth_school_id();
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  update public.schools set report_settings = p_settings where id = v_school_id;
end;
$function$;

revoke all on function public.update_report_settings(jsonb) from public, anon;
grant execute on function public.update_report_settings(jsonb) to authenticated;
