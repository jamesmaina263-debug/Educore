
-- One report card per student per exam. Deliberately thin — subject marks/grades are read live from
-- `marks` (already locked after exam close, so this doesn't drift), and rank from `class_rankings`.
-- This table's only real job is the comment lifecycle: draft -> teacher review -> approved/rewritten.
-- Can only be generated from a closed exam (mirrors the blueprint rule directly).
create table report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  comment text,
  comment_source text not null default 'none' check (comment_source in ('none', 'ai', 'teacher_approved', 'teacher_written')),
  approved_by uuid references school_users(id),
  approved_at timestamptz,
  generated_at timestamptz not null default now(),
  generated_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id)
);
comment on table report_cards is 'Per-student report card for a closed exam. comment_source=ai is a suggestion only — never visible to a parent until a teacher flips it to teacher_approved (or writes their own, teacher_written). No AI text reaches a parent unreviewed, per blueprint 7.3.';

alter table report_cards enable row level security;

create index report_cards_school_id_idx on report_cards (school_id);
create index report_cards_class_id_idx on report_cards (class_id);
create index report_cards_student_id_idx on report_cards (student_id);
create index report_cards_approved_by_idx on report_cards (approved_by);
create index report_cards_generated_by_idx on report_cards (generated_by);

-- New permissions: broad staff read piggybacks on exams.read (a report card is just a view over
-- exam results); generation is exams.write (same people who can close an exam); approval is its
-- own scoped/broad pair, matching the marks.write / marks.write_any shape, because "who can close
-- an exam" and "who can approve a comment for their own homeroom" are different populations
-- (a subject teacher who isn't a class teacher has neither).
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values ('report_cards.approve'), ('report_cards.approve_any')) as p(permission_key)
where
  (r.name = 'class_teacher' and p.permission_key = 'report_cards.approve')
  or (r.name in ('deputy_principal','principal','school_owner') and p.permission_key = 'report_cards.approve_any');

create policy report_cards_select on report_cards for select
  using (school_id = auth_school_id() and auth_has_permission('exams.read'));

create policy report_cards_insert on report_cards for insert
  with check (school_id = auth_school_id() and auth_has_permission('exams.write'));

create policy report_cards_delete on report_cards for delete
  using (school_id = auth_school_id() and auth_has_permission('exams.write'));

-- Approve/rewrite: a class teacher may only touch report cards for their own stream(s); deputy/
-- principal/owner may touch any. Generation-only fields (comment_source='ai', approved_by/at null)
-- are set by generate_report_cards(); this policy governs the human review step afterward.
create policy report_cards_update_own_class on report_cards for update
  using (
    school_id = auth_school_id() and auth_has_permission('report_cards.approve')
    and exists (select 1 from streams st where st.class_id = report_cards.class_id and st.class_teacher_id = (select id from school_users where auth_user_id = auth.uid()))
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('report_cards.approve')
    and exists (select 1 from streams st where st.class_id = report_cards.class_id and st.class_teacher_id = (select id from school_users where auth_user_id = auth.uid()))
  );

create policy report_cards_update_any on report_cards for update
  using (school_id = auth_school_id() and auth_has_permission('report_cards.approve_any'))
  with check (school_id = auth_school_id() and auth_has_permission('report_cards.approve_any'));

-- Generates (or refreshes) one report_cards row per active student in the class, for a closed exam
-- only. Idempotent — re-running before any comment work is untouched; re-running after a comment
-- exists leaves that row alone (won't clobber a teacher's approved/written comment).
create or replace function generate_report_cards(p_exam_id uuid, p_class_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_status text;
  v_generated_by uuid;
  v_count integer;
begin
  if not auth_has_permission('exams.write') then
    raise exception 'Not authorized to generate report cards.';
  end if;
  select status into v_status from exams where id = p_exam_id and school_id = v_school_id;
  if v_status is null then
    raise exception 'Exam not found.';
  end if;
  if v_status != 'closed' then
    raise exception 'Report cards can only be generated from a closed exam.';
  end if;

  select id into v_generated_by from school_users where auth_user_id = auth.uid();

  insert into report_cards (school_id, exam_id, class_id, student_id, generated_by)
  select v_school_id, p_exam_id, p_class_id, st.id, v_generated_by
  from students st
  where st.status = 'active'
    and st.current_class_id in (select id from streams where class_id = p_class_id)
  on conflict (exam_id, student_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function generate_report_cards(uuid, uuid) from public;
grant execute on function generate_report_cards(uuid, uuid) to authenticated;
