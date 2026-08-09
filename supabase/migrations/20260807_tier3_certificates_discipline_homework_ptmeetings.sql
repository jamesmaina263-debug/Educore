-- Gap analysis Tier 3, built ahead of the roadmap's own "wait for a real school to ask"
-- recommendation, per explicit instruction to build all 5 now rather than defer them.

-- ============================================================================
-- #20 Certificates — a durable issued record (completion/achievement/etc.), distinct from a
-- report card. Deliberately simple: no approval workflow (unlike discounts/expenses) since
-- issuing a certificate isn't a financial or academic-integrity decision the way those are —
-- it's closer to teacher_performance_reviews in shape (a record of something that happened),
-- so it gets the same "write" tier without a separate approve step.
-- ============================================================================
create table certificates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  certificate_type text not null check (certificate_type in ('completion','achievement','good_conduct','sports','academic_excellence','other')),
  title text not null,
  description text,
  issued_date date not null default current_date,
  issued_by uuid references school_users(id),
  created_at timestamptz not null default now()
);

create index certificates_student_id_idx on certificates(student_id);

alter table certificates enable row level security;

create policy certificates_select_staff on certificates for select
  using (school_id = auth_school_id() and auth_has_permission('students.read'));

create policy certificates_select_guardian on certificates for select
  using (auth_user_id_is_guardian_of(certificates.student_id));

create policy certificates_select_self on certificates for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = certificates.student_id and su.auth_user_id = (select auth.uid())));

create policy certificates_insert on certificates for insert
  with check (school_id = auth_school_id() and auth_has_permission('certificates.write'));

create policy certificates_update on certificates for update
  using (school_id = auth_school_id() and auth_has_permission('certificates.write'))
  with check (school_id = auth_school_id() and auth_has_permission('certificates.write'));

create policy certificates_delete on certificates for delete
  using (school_id = auth_school_id() and auth_has_permission('certificates.write'));

-- ============================================================================
-- #22 Discipline / behavior records. Sensitive by nature (this is data about a minor's conduct,
-- not their health — health data stays out of this platform's scope entirely, this is a
-- disciplinary/behavioral log same category as a school's existing paper conduct book). Two
-- staff tiers same convention as attendance/exams: `discipline.write` to record/edit,
-- `discipline.read_any` for broad staff visibility (Deputy/Principal/Owner); a staff member who
-- only has write can still see records they personally recorded, same as exams.write implying
-- self-visibility elsewhere in this schema. visible_to_guardian defaults true but lets a school
-- keep an internal-only note (e.g. still under investigation) off a parent's view until resolved.
-- ============================================================================
create table discipline_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  incident_date date not null default current_date,
  category text not null check (category in ('minor','moderate','major')),
  description text not null,
  action_taken text,
  visible_to_guardian boolean not null default true,
  recorded_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index discipline_records_student_id_idx on discipline_records(student_id);

alter table discipline_records enable row level security;

create policy discipline_records_select_staff on discipline_records for select
  using (
    school_id = auth_school_id()
    and (
      auth_has_permission('discipline.read_any')
      or recorded_by = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  );

create policy discipline_records_select_guardian on discipline_records for select
  using (auth_user_id_is_guardian_of(discipline_records.student_id) and visible_to_guardian = true);

create policy discipline_records_select_self on discipline_records for select
  using (
    visible_to_guardian = true
    and exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = discipline_records.student_id and su.auth_user_id = (select auth.uid()))
  );

create policy discipline_records_insert on discipline_records for insert
  with check (school_id = auth_school_id() and auth_has_permission('discipline.write'));

create policy discipline_records_update on discipline_records for update
  using (
    school_id = auth_school_id()
    and (auth_has_permission('discipline.read_any') or recorded_by = (select id from school_users where auth_user_id = (select auth.uid())))
    and auth_has_permission('discipline.write')
  )
  with check (school_id = auth_school_id() and auth_has_permission('discipline.write'));

create policy discipline_records_delete on discipline_records for delete
  using (school_id = auth_school_id() and auth_has_permission('discipline.read_any'));

-- ============================================================================
-- #21 Homework / assignment submission. Text-only submissions for v1 — no file upload, to avoid
-- a storage-bucket policy expansion this session; a real deliverable-file requirement is a real
-- gap worth flagging for later, not silently pretended away. assignment_submissions.status
-- starts 'submitted', a teacher moves it to 'graded' when they add a grade — no separate
-- "late" computed status stored (due_date vs submitted_at can always be compared at read time,
-- keeping the write side simple).
-- ============================================================================
create table assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  stream_id uuid not null references streams(id),
  subject_id uuid not null references subjects(id),
  teacher_id uuid references school_users(id),
  title text not null,
  description text,
  due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assignments_stream_id_idx on assignments(stream_id);

create table assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references students(id),
  submission_text text not null,
  status text not null default 'submitted' check (status in ('submitted','graded')),
  grade text,
  feedback text,
  graded_by uuid references school_users(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

alter table assignments enable row level security;
alter table assignment_submissions enable row level security;

create policy assignments_select_staff on assignments for select
  using (school_id = auth_school_id() and auth_has_permission('academics.read'));

create policy assignments_select_guardian on assignments for select
  using (exists (select 1 from students st join student_guardians sg on sg.student_id = st.id join school_users su on su.id = sg.guardian_user_id where st.current_class_id = assignments.stream_id and su.auth_user_id = (select auth.uid())));

create policy assignments_select_self on assignments for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.current_class_id = assignments.stream_id and su.auth_user_id = (select auth.uid())));

create policy assignments_insert on assignments for insert
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

create policy assignments_update on assignments for update
  using (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  )
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

create policy assignments_delete on assignments for delete
  using (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

-- Submissions: a guardian/student may only insert for their own child/self, and only for an
-- assignment whose stream actually matches the student's current class — prevents submitting
-- homework for the wrong class even if someone guesses another assignment's id.
create policy assignment_submissions_select_staff on assignment_submissions for select
  using (
    exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (auth_has_permission('academics.read') or a.teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
    )
  );

create policy assignment_submissions_select_guardian on assignment_submissions for select
  using (auth_user_id_is_guardian_of(assignment_submissions.student_id));

create policy assignment_submissions_select_self on assignment_submissions for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = assignment_submissions.student_id and su.auth_user_id = (select auth.uid())));

create policy assignment_submissions_insert_guardian on assignment_submissions for insert
  with check (
    auth_user_id_is_guardian_of(assignment_submissions.student_id)
    and exists (select 1 from assignments a join students st on st.current_class_id = a.stream_id where a.id = assignment_submissions.assignment_id and st.id = assignment_submissions.student_id)
  );

create policy assignment_submissions_insert_self on assignment_submissions for insert
  with check (
    exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = assignment_submissions.student_id and su.auth_user_id = (select auth.uid()))
    and exists (select 1 from assignments a join students st2 on st2.current_class_id = a.stream_id where a.id = assignment_submissions.assignment_id and st2.id = assignment_submissions.student_id)
  );

-- Resubmission before grading, by the same guardian/student who submitted.
create policy assignment_submissions_update_own on assignment_submissions for update
  using (
    status = 'submitted'
    and (auth_user_id_is_guardian_of(assignment_submissions.student_id)
      or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = assignment_submissions.student_id and su.auth_user_id = (select auth.uid())))
  )
  with check (
    status = 'submitted'
    and (auth_user_id_is_guardian_of(assignment_submissions.student_id)
      or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = assignment_submissions.student_id and su.auth_user_id = (select auth.uid())))
  );

-- Grading, by the assignment's own teacher or academics.write staff.
create policy assignment_submissions_update_grade on assignment_submissions for update
  using (
    exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (auth_has_permission('academics.write') or a.teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
    )
  )
  with check (
    exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (auth_has_permission('academics.write') or a.teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
    )
  );

-- ============================================================================
-- #23 Parent-teacher meeting scheduling. A teacher publishes slots; any guardian/student in the
-- school can see them (same "everyone in the school can see availability" logic as a physical
-- sign-up sheet), but only a guardian can book one, and only for their own child. capacity>1
-- allows a teacher to double-book a slot deliberately (e.g. quick 5-minute check-ins) — the
-- trigger enforces it isn't exceeded, same pattern as inventory's stock-movement guard.
-- ============================================================================
create table pt_meeting_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  teacher_id uuid not null references school_users(id),
  term_id uuid references terms(id),
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  location text,
  capacity integer not null default 1 check (capacity > 0),
  created_at timestamptz not null default now()
);

create table pt_meeting_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references pt_meeting_slots(id) on delete cascade,
  student_id uuid not null references students(id),
  guardian_user_id uuid not null references school_users(id),
  notes text,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now()
);

create index pt_meeting_bookings_slot_id_idx on pt_meeting_bookings(slot_id);

create or replace function check_pt_slot_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_capacity integer;
  v_booked integer;
begin
  if new.status != 'booked' then
    return new;
  end if;
  select capacity into v_capacity from pt_meeting_slots where id = new.slot_id;
  select count(*) into v_booked from pt_meeting_bookings where slot_id = new.slot_id and status = 'booked' and id != new.id;
  if v_booked >= v_capacity then
    raise exception 'This meeting slot is already fully booked.';
  end if;
  return new;
end;
$$;

create trigger pt_meeting_bookings_capacity_check
  before insert or update on pt_meeting_bookings
  for each row execute function check_pt_slot_capacity();

alter table pt_meeting_slots enable row level security;
alter table pt_meeting_bookings enable row level security;

-- Anyone active in the school (staff, guardian, or student) can see published slots — same
-- visibility as a physical sign-up sheet on a noticeboard.
create policy pt_meeting_slots_select on pt_meeting_slots for select
  using (school_id = auth_school_id());

create policy pt_meeting_slots_insert on pt_meeting_slots for insert
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

create policy pt_meeting_slots_update on pt_meeting_slots for update
  using (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  )
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

create policy pt_meeting_slots_delete on pt_meeting_slots for delete
  using (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
  );

create policy pt_meeting_bookings_select_guardian on pt_meeting_bookings for select
  using (guardian_user_id = (select id from school_users where auth_user_id = (select auth.uid())));

create policy pt_meeting_bookings_select_staff on pt_meeting_bookings for select
  using (
    exists (
      select 1 from pt_meeting_slots s
      where s.id = pt_meeting_bookings.slot_id
        and s.school_id = auth_school_id()
        and (auth_has_permission('academics.write') or s.teacher_id = (select id from school_users where auth_user_id = (select auth.uid())))
    )
  );

create policy pt_meeting_bookings_insert on pt_meeting_bookings for insert
  with check (
    guardian_user_id = (select id from school_users where auth_user_id = (select auth.uid()))
    and auth_user_id_is_guardian_of(pt_meeting_bookings.student_id)
  );

create policy pt_meeting_bookings_update_own on pt_meeting_bookings for update
  using (guardian_user_id = (select id from school_users where auth_user_id = (select auth.uid())))
  with check (guardian_user_id = (select id from school_users where auth_user_id = (select auth.uid())));

-- New permission keys, seeded platform-wide (school_id null = default for every school, same
-- convention as every existing permission). Teacher gets discipline.write and academics-tier
-- assignment/PT-slot creation implicitly via the "own record" clauses above, not a blanket grant.
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.key, true
from roles r
cross join (values
  ('certificates.write'),
  ('discipline.write'),
  ('discipline.read_any')
) as p(key)
where r.name in ('school_owner','principal','deputy_principal');

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'discipline.write', true
from roles r where r.name in ('teacher','class_teacher');

-- check_pt_slot_capacity is a trigger function only, never meant to be called directly via RPC —
-- same fix already applied to check_consecutive_absences. Advisor flagged it as anon-executable
-- because SECURITY DEFINER functions default to PUBLIC EXECUTE grants.
revoke execute on function check_pt_slot_capacity() from public, anon, authenticated;
