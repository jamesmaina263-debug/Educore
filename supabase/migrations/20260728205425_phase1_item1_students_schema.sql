-- Phase 1, Item 1: Students, Guardians, Documents, Medical Records

create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  admission_number text not null,
  upi_number text,
  first_name text not null,
  last_name text not null,
  other_names text,
  date_of_birth date not null,
  gender text not null check (gender in ('male', 'female')),
  -- No FK yet: `classes` doesn't exist until Phase 1 Item 2 (Academics).
  -- Constraint gets added in that migration; this column is just ready.
  current_class_id uuid,
  status text not null default 'active'
    check (status in ('applied', 'approved', 'enrolled', 'active', 'withdrawn', 'transferred', 'graduated')),
  admission_date date not null default current_date,
  photo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, admission_number)
);

create index idx_students_school_id on students(school_id);
create index idx_students_status on students(school_id, status);
create index idx_students_name on students(school_id, last_name, first_name);

create trigger trg_students_updated_at
  before update on students
  for each row execute function set_updated_at();

-- ============================================================
-- student_guardians: links a student to an existing school_users row
-- with role = 'parent'. Deliberately not a separate `guardians` table --
-- a guardian IS a parent identity (phone, OTP login) already modeled in
-- Phase 0; this junction only adds the relationship-specific data.
-- ============================================================
create table student_guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  guardian_user_id uuid not null references school_users(id) on delete cascade,
  relationship text not null check (relationship in ('mother', 'father', 'guardian', 'other')),
  primary_contact boolean not null default false,
  created_at timestamptz not null default now(),
  unique (student_id, guardian_user_id)
);

create index idx_student_guardians_student_id on student_guardians(student_id);
create index idx_student_guardians_guardian_user_id on student_guardians(guardian_user_id);

-- Enforces that the linked school_users row is actually a parent, and
-- belongs to the same school as the student -- a guardian link across
-- schools or to a non-parent role would be a data-integrity bug, not
-- just an RLS concern.
create or replace function enforce_guardian_link_validity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role_name text;
  v_guardian_school_id uuid;
  v_student_school_id uuid;
begin
  select r.name, su.school_id into v_role_name, v_guardian_school_id
  from school_users su join roles r on r.id = su.role_id
  where su.id = new.guardian_user_id;

  if v_role_name <> 'parent' then
    raise exception 'guardian_user_id must reference a school_users row with role = parent';
  end if;

  select school_id into v_student_school_id from students where id = new.student_id;

  if v_guardian_school_id is distinct from v_student_school_id then
    raise exception 'guardian and student must belong to the same school';
  end if;

  return new;
end;
$$;

create trigger trg_student_guardians_enforce_validity
  before insert or update on student_guardians
  for each row execute function enforce_guardian_link_validity();

-- Business rule (§D): a student must have at least one primary-contact
-- guardian before status can be 'active' or 'enrolled' -- SMS has to go
-- somewhere. Checked on the students side (status change), not the
-- guardian side, since that's where the rule is actually violated.
create or replace function enforce_student_has_primary_guardian()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('active', 'enrolled') then
    if not exists (
      select 1 from student_guardians
      where student_id = new.id and primary_contact = true
    ) then
      raise exception 'a student must have at least one primary-contact guardian before status can be active/enrolled';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_students_enforce_primary_guardian
  before insert or update on students
  for each row execute function enforce_student_has_primary_guardian();
