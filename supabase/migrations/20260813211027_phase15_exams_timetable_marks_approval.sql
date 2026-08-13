-- ============================================================================
-- Phase 15 (5/6): Exams -- exam timetable, marks entry/approval, transcripts
-- input support (Brief 4.5)
-- exams/marks/competency_marks/report_cards/class_rankings/grading_scales
-- already work well and are REUSEd untouched. report_cards already has a
-- real "result publishing" gate (comment_source IN teacher_approved/
-- teacher_written controls guardian/student visibility) -- confirmed via
-- its live RLS policy, not rebuilt here. This adds: exam scheduling, a
-- marks entry/approval workflow mirroring the existing report_cards.approve
-- pattern exactly, and the columns transcripts/result-analysis views read.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Exam timetable
-- ---------------------------------------------------------------------------
create table public.exam_schedules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  exam_id uuid not null references public.exams(id),
  subject_id uuid not null references public.subjects(id),
  class_id uuid references public.classes(id),
  exam_date date not null,
  start_time time,
  end_time time,
  venue text,
  created_at timestamptz not null default now()
);

create index exam_schedules_exam_idx on public.exam_schedules(exam_id);

alter table public.exam_schedules enable row level security;

create policy exam_schedules_select on public.exam_schedules for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('exams.read')));

create policy exam_schedules_write on public.exam_schedules for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('exams.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('exams.write')));

-- ---------------------------------------------------------------------------
-- Marks entry/approval -- mirrors report_cards' own approved_by/approved_at
-- pattern exactly, and reuses the same class-teacher-vs-broad permission
-- split (marks.approve / marks.approve_any) already established for
-- report_cards.approve / report_cards.approve_any.
-- ---------------------------------------------------------------------------
alter table public.marks
  add column status text not null default 'submitted' check (status in ('submitted','approved')),
  add column approved_by uuid references public.school_users(id),
  add column approved_at timestamptz;

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'marks.approve', true
from public.roles r
where r.name = 'class_teacher'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'marks.approve');

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'marks.approve_any', true
from public.roles r
where r.name in ('deputy_principal', 'principal', 'school_owner')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'marks.approve_any');

create policy marks_approve_any on public.marks for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('marks.approve_any')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('marks.approve_any')));

create policy marks_approve_own_class on public.marks for update
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id()
      and auth_has_permission('marks.approve')
      and exists (
        select 1 from public.students s join public.streams st on st.id = s.current_class_id
        where s.id = marks.student_id and st.class_teacher_id = auth_school_user_id()
      )
    )
  );
