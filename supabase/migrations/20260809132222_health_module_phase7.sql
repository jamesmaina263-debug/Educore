-- ============================================================
-- Phase 7: Health Module — Sick Bay, Medication, Referrals,
-- Emergencies, Nurse role, Medical Inventory convention.
-- Reuses existing medical_records / students.medical.* and the
-- auth_school_id()/auth_has_permission()/auth_is_super_admin()/
-- auth_user_id_is_guardian_of()/auth_user_is_class_teacher_of()
-- helper functions already used by discipline_records/hostel/medical_records.
-- ============================================================

-- 1. Sick Bay / Clinic visits (check-in / check-out)
create table public.sick_bay_visits (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  check_in_at timestamptz not null default now(),
  reason text not null,
  symptoms text,
  temperature_c numeric,
  checked_in_by uuid references public.school_users(id),
  check_out_at timestamptz,
  check_out_by uuid references public.school_users(id),
  outcome text check (outcome = ANY (ARRAY['returned_to_class','sent_home','referred','admitted_emergency'])),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sick_bay_checkout_after_checkin check (check_out_at is null or check_out_at >= check_in_at)
);

comment on table public.sick_bay_visits is 'One row per clinic/sick-bay visit. outcome is null while the student is still checked in; check_out_at/check_out_by/outcome are set together at check-out.';

-- 2. Medication administration log
create table public.medication_administrations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  sick_bay_visit_id uuid references public.sick_bay_visits(id),
  medication_name text not null,
  dosage text not null,
  route text not null default 'oral' check (route = ANY (ARRAY['oral','topical','injection','inhaled','other'])),
  administered_at timestamptz not null default now(),
  administered_by uuid references public.school_users(id),
  inventory_item_id uuid references public.inventory_items(id),
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.medication_administrations is 'Every dose given to a student, whether tied to a sick_bay_visits row or an ongoing prescription (e.g. daily inhaler). inventory_item_id links to the existing Inventory module for stock deduction, not a separate medical stock system.';

-- 3. Referrals (to hospital/clinic/specialist)
create table public.health_referrals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  sick_bay_visit_id uuid references public.sick_bay_visits(id),
  referred_to text not null,
  reason text not null,
  referral_date date not null default current_date,
  status text not null default 'pending' check (status = ANY (ARRAY['pending','completed','cancelled'])),
  guardian_notified boolean not null default false,
  outcome_notes text,
  referred_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Emergency cases
create table public.health_emergencies (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  sick_bay_visit_id uuid references public.sick_bay_visits(id),
  incident_at timestamptz not null default now(),
  description text not null,
  severity text not null default 'moderate' check (severity = ANY (ARRAY['moderate','severe','critical'])),
  action_taken text,
  hospital_name text,
  guardian_notified boolean not null default false,
  guardian_notified_at timestamptz,
  reported_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.health_emergencies is 'Serious/critical incidents, distinct from routine sick_bay_visits. Always requires guardian_notified tracking.';

-- Indexes
create index sick_bay_visits_school_student_idx on public.sick_bay_visits(school_id, student_id);
create index sick_bay_visits_open_idx on public.sick_bay_visits(school_id) where check_out_at is null;
create index medication_administrations_school_student_idx on public.medication_administrations(school_id, student_id);
create index health_referrals_school_student_idx on public.health_referrals(school_id, student_id);
create index health_emergencies_school_student_idx on public.health_emergencies(school_id, student_id);

-- RLS
alter table public.sick_bay_visits enable row level security;
alter table public.medication_administrations enable row level security;
alter table public.health_referrals enable row level security;
alter table public.health_emergencies enable row level security;

-- sick_bay_visits policies
create policy sick_bay_visits_select on public.sick_bay_visits for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or auth_user_is_class_teacher_of(student_id)
  );

create policy sick_bay_visits_insert on public.sick_bay_visits for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

create policy sick_bay_visits_update on public.sick_bay_visits for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

-- medication_administrations policies
create policy medication_administrations_select on public.medication_administrations for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
    or auth_user_id_is_guardian_of(student_id)
  );

create policy medication_administrations_insert on public.medication_administrations for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

create policy medication_administrations_update on public.medication_administrations for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

-- health_referrals policies
create policy health_referrals_select on public.health_referrals for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
    or auth_user_id_is_guardian_of(student_id)
  );

create policy health_referrals_insert on public.health_referrals for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

create policy health_referrals_update on public.health_referrals for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

-- health_emergencies policies
create policy health_emergencies_select on public.health_emergencies for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or auth_user_is_class_teacher_of(student_id)
  );

create policy health_emergencies_insert on public.health_emergencies for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

create policy health_emergencies_update on public.health_emergencies for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('health.write')));

-- 5. Nurse role + permissions
insert into public.roles (name, display_name, description, is_system_role)
select 'nurse', 'Nurse', 'School nurse / clinic officer. Manages sick bay, medication, referrals, emergencies and student medical records.', true
where not exists (select 1 from public.roles where name = 'nurse');

-- health.* + students.medical.* permission keys for the nurse role, for every existing school
-- (role_permissions here are school-scoped rows, matching the existing pattern for other roles)
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, s.id, perm.key, true
from public.roles r
cross join public.schools s
cross join (values
  ('health.read_any'),
  ('health.write'),
  ('students.medical.read'),
  ('students.medical.write'),
  ('inventory.read_any')
) as perm(key)
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id = s.id and rp.permission_key = perm.key
  );

-- Also grant health.read_any to Principal/Deputy Principal/School Owner/Group Admin so leadership
-- can see the Health dashboard without being the Nurse (matches existing discipline.read_any pattern
-- of being available to school leadership roles).
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, s.id, 'health.read_any', true
from public.roles r
cross join public.schools s
where r.name in ('principal', 'deputy_principal', 'school_owner', 'group_admin')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id = s.id and rp.permission_key = 'health.read_any'
  );

-- 6. Medical inventory convention: seed a "Medical Supplies" inventory category per school
-- (reuses the existing Inventory module rather than creating a parallel stock system).
insert into public.inventory_categories (school_id, name)
select s.id, 'Medical Supplies'
from public.schools s
where not exists (
  select 1 from public.inventory_categories ic where ic.school_id = s.id and ic.name = 'Medical Supplies'
);
