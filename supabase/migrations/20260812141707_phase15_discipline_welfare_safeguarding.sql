-- ============================================================================
-- Phase 15 (EduCore 20-phase plan) — Discipline & Welfare module (Brief 4.3)
-- Extends the existing flat discipline_records (built in gap-closure Tier 3)
-- into a real case-management system, and adds Welfare and Safeguarding as
-- genuinely new, more tightly-restricted entities per the brief's explicit
-- instruction to never expose safeguarding data to ordinary teachers.
-- ============================================================================

-- New permission keys. discipline.read_any/write already exist and are
-- currently held by teacher/class_teacher (confirmed live) — that's correct
-- for ordinary incident logging, but case management and safeguarding need
-- their own tighter tiers.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
cross join (values
  ('discipline.cases.manage'),
  ('welfare.write'),
  ('welfare.read_any'),
  ('safeguarding.write'),
  ('safeguarding.read')
) as p(key)
where r.name in ('principal','deputy_principal','school_owner')
on conflict do nothing;

-- Ordinary teachers/class teachers can raise a welfare concern (e.g. "this
-- student seems withdrawn") but cannot browse all concerns school-wide —
-- same self-visibility pattern as discipline.write without discipline.read_any.
insert into role_permissions (role_id, permission_key)
select r.id, 'welfare.write'
from roles r
where r.name in ('teacher','class_teacher')
on conflict do nothing;

-- ============================================================================
-- Disciplinary Action Types — configurable per school (brief: "warning,
-- detention, suspension, other"). School-scoped, seeded per-school like
-- leave_types (no auto-seed trigger exists for that pattern either).
-- ============================================================================
create table disciplinary_action_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  name text not null,
  category text not null check (category in ('warning','detention','suspension','other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index disciplinary_action_types_school_name_idx
  on disciplinary_action_types(school_id, name);

alter table disciplinary_action_types enable row level security;

create policy disciplinary_action_types_select on disciplinary_action_types for select
  using (school_id = auth_school_id() and (auth_has_permission('discipline.read_any') or auth_has_permission('discipline.write')));

create policy disciplinary_action_types_write on disciplinary_action_types for all
  using (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'))
  with check (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

-- ============================================================================
-- Discipline Cases — the case wrapper the brief describes (status, assigned
-- officer, investigation notes, follow-up, resolution, closure). An incident
-- can optionally escalate into a case; not every incident needs one.
-- ============================================================================
create table discipline_cases (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  title text not null,
  status text not null default 'open' check (status in ('open','investigating','pending_action','resolved','closed')),
  assigned_officer uuid references school_users(id),
  investigation_notes text,
  follow_up_notes text,
  resolution text,
  opened_by uuid references school_users(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references school_users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index discipline_cases_student_id_idx on discipline_cases(student_id);
create index discipline_cases_school_status_idx on discipline_cases(school_id, status);

alter table discipline_cases enable row level security;

create policy discipline_cases_select on discipline_cases for select
  using (
    school_id = auth_school_id() and (
      auth_has_permission('discipline.read_any')
      or opened_by = (select id from school_users where auth_user_id = (select auth.uid()))
      or assigned_officer = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  );

create policy discipline_cases_insert on discipline_cases for insert
  with check (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

create policy discipline_cases_update on discipline_cases for update
  using (
    school_id = auth_school_id() and (
      auth_has_permission('discipline.cases.manage')
      or assigned_officer = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  )
  with check (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

create policy discipline_cases_delete on discipline_cases for delete
  using (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

-- ============================================================================
-- Extend discipline_records (the existing incident log) with the remaining
-- fields the brief's Incidents spec requires, and a link to an escalated case.
-- ============================================================================
alter table discipline_records
  add column incident_type text,
  add column incident_time time,
  add column location text,
  add column reported_by uuid references school_users(id),
  add column case_id uuid references discipline_cases(id);

create index discipline_records_case_id_idx on discipline_records(case_id);

-- Staff involved in an incident — separate join table for real FK integrity
-- rather than a bare uuid[] column.
create table discipline_incident_staff (
  incident_id uuid not null references discipline_records(id) on delete cascade,
  staff_id uuid not null references school_users(id),
  school_id uuid not null references schools(id),
  primary key (incident_id, staff_id)
);

alter table discipline_incident_staff enable row level security;

create policy discipline_incident_staff_select on discipline_incident_staff for select
  using (school_id = auth_school_id() and (auth_has_permission('discipline.read_any') or auth_has_permission('discipline.write')));

create policy discipline_incident_staff_write on discipline_incident_staff for all
  using (school_id = auth_school_id() and auth_has_permission('discipline.write'))
  with check (school_id = auth_school_id() and auth_has_permission('discipline.write'));

-- ============================================================================
-- Disciplinary Actions — the actual action taken (references a configurable
-- type), optionally tied to a case and/or a specific incident.
-- ============================================================================
create table disciplinary_actions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  case_id uuid references discipline_cases(id),
  incident_id uuid references discipline_records(id),
  action_type_id uuid not null references disciplinary_action_types(id),
  description text,
  start_date date,
  end_date date,
  issued_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  constraint disciplinary_actions_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);

create index disciplinary_actions_student_id_idx on disciplinary_actions(student_id);

alter table disciplinary_actions enable row level security;

create policy disciplinary_actions_select on disciplinary_actions for select
  using (
    school_id = auth_school_id() and (
      auth_has_permission('discipline.read_any')
      or issued_by = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  );

create policy disciplinary_actions_select_guardian on disciplinary_actions for select
  using (auth_user_id_is_guardian_of(disciplinary_actions.student_id));

create policy disciplinary_actions_select_self on disciplinary_actions for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = disciplinary_actions.student_id and su.auth_user_id = (select auth.uid())));

create policy disciplinary_actions_insert on disciplinary_actions for insert
  with check (school_id = auth_school_id() and auth_has_permission('discipline.write'));

create policy disciplinary_actions_update on disciplinary_actions for update
  using (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'))
  with check (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

create policy disciplinary_actions_delete on disciplinary_actions for delete
  using (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage'));

-- ============================================================================
-- Welfare — concerns, counselling referrals, follow-up. Distinct from
-- discipline: a welfare concern is not a behavioral infraction. Staff-only,
-- no guardian/student visibility by default (matches the brief's framing of
-- this as staff-managed support, not a parent-facing log).
-- ============================================================================
create table welfare_concerns (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  concern_type text not null,
  description text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  counselling_referral boolean not null default false,
  referred_to text,
  follow_up_notes text,
  raised_by uuid references school_users(id),
  resolved_at timestamptz,
  resolved_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index welfare_concerns_student_id_idx on welfare_concerns(student_id);

alter table welfare_concerns enable row level security;

create policy welfare_concerns_select on welfare_concerns for select
  using (
    school_id = auth_school_id() and (
      auth_has_permission('welfare.read_any')
      or raised_by = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  );

create policy welfare_concerns_insert on welfare_concerns for insert
  with check (school_id = auth_school_id() and auth_has_permission('welfare.write'));

create policy welfare_concerns_update on welfare_concerns for update
  using (
    school_id = auth_school_id() and (
      auth_has_permission('welfare.read_any')
      or raised_by = (select id from school_users where auth_user_id = (select auth.uid()))
    )
  )
  with check (school_id = auth_school_id() and auth_has_permission('welfare.write'));

create policy welfare_concerns_delete on welfare_concerns for delete
  using (school_id = auth_school_id() and auth_has_permission('welfare.read_any'));

-- ============================================================================
-- Safeguarding / Child Protection — deliberately its own table with its own
-- permission tier (safeguarding.read / safeguarding.write), granted only to
-- principal/deputy_principal/school_owner/super_admin. Confirmed live:
-- teacher and class_teacher hold discipline.write/welfare.write but NOT
-- safeguarding.* — this table is unreachable to them at the RLS layer, not
-- just hidden in the UI. No guardian or student policy exists at all.
-- ============================================================================
create table safeguarding_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  report_type text not null check (report_type in ('concern','bullying','abuse','high_risk','other')),
  description text not null,
  status text not null default 'open' check (status in ('open','escalated','investigating','resolved','closed')),
  escalated_to uuid references school_users(id),
  escalated_at timestamptz,
  follow_up_notes text,
  reported_by uuid references school_users(id),
  resolved_at timestamptz,
  resolved_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index safeguarding_reports_student_id_idx on safeguarding_reports(student_id);

alter table safeguarding_reports enable row level security;

create policy safeguarding_reports_select on safeguarding_reports for select
  using (school_id = auth_school_id() and auth_has_permission('safeguarding.read'));

create policy safeguarding_reports_insert on safeguarding_reports for insert
  with check (school_id = auth_school_id() and auth_has_permission('safeguarding.write'));

create policy safeguarding_reports_update on safeguarding_reports for update
  using (school_id = auth_school_id() and auth_has_permission('safeguarding.read'))
  with check (school_id = auth_school_id() and auth_has_permission('safeguarding.write'));

create policy safeguarding_reports_delete on safeguarding_reports for delete
  using (school_id = auth_school_id() and auth_has_permission('safeguarding.write'));
