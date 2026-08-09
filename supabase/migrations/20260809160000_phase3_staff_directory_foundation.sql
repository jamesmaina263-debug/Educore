-- Phase 3: Staff/HR employment fields, qualifications, and leave management.
-- Extends the existing single-identity school_users table (never a duplicate staff record).

alter table public.school_users
  add column if not exists position text,
  add column if not exists department text,
  add column if not exists hire_date date,
  add column if not exists contract_type text,
  add column if not exists contract_end_date date;

alter table public.school_users
  add constraint school_users_contract_type_check
  check (contract_type is null or contract_type in ('permanent', 'contract', 'part_time'));

comment on column public.school_users.position is 'Staff only: job title/position. Null for parent/student roles.';
comment on column public.school_users.department is 'Staff only: department name (free text for now, matches existing academics.departments pattern if present).';

-- Qualifications / certifications, linkable to an uploaded document (no duplicate document storage).
create table public.staff_qualifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.school_users(id) on delete cascade,
  qualification_name text not null,
  institution text,
  year_obtained int,
  document_id uuid references public.documents(id) on delete set null,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index idx_staff_qualifications_staff_id on public.staff_qualifications(staff_id);
create index idx_staff_qualifications_school_id on public.staff_qualifications(school_id);

alter table public.staff_qualifications enable row level security;

create policy staff_qualifications_select on public.staff_qualifications
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.read'))
    or staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
  );

create policy staff_qualifications_write on public.staff_qualifications
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  );

-- Leave management: types (school-configurable), requests, approval.
-- Balance is computed live from approved requests, never stored separately.
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  days_per_year int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

alter table public.leave_types enable row level security;

create policy leave_types_select on public.leave_types
  for select using (
    auth_is_super_admin()
    or school_id = auth_school_id()
  );

create policy leave_types_write on public.leave_types
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  );

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.school_users(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id),
  start_date date not null,
  end_date date not null,
  days_count numeric not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid references public.school_users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index idx_leave_requests_staff_id on public.leave_requests(staff_id);
create index idx_leave_requests_school_id on public.leave_requests(school_id, status);

alter table public.leave_requests enable row level security;

create policy leave_requests_select on public.leave_requests
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('staff.read') or auth_has_permission('staff.leave.approve')))
    or staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
  );

create policy leave_requests_insert on public.leave_requests
  for insert with check (
    auth_is_super_admin()
    or staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  );

-- Only pending requests may be edited by the requester (e.g. cancel); approval requires staff.leave.approve.
create policy leave_requests_update_own_pending on public.leave_requests
  for update using (
    staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
    and status = 'pending'
  ) with check (
    staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
    and status in ('pending', 'cancelled')
  );

create policy leave_requests_approve on public.leave_requests
  for update using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.leave.approve'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.leave.approve'))
  );

-- New permission keys, granted to the same roles that already hold staff.manage,
-- so the effective access boundary doesn't silently change for anyone.
insert into public.role_permissions (role_id, permission_key)
select r.id, perm
from public.roles r
cross join (values ('staff.read'), ('staff.leave.approve')) as p(perm)
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;
