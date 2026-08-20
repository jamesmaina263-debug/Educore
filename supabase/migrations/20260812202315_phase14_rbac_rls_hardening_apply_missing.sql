-- Phase 14: RBAC/RLS Hardening & Cross-Module Access Testing (Brief Section 7, Section 9)
-- Applying the file that already exists at supabase/migrations/20260812041507_phase14_rbac_rls_hardening.sql
-- verbatim. Confirmed via list_migrations + a missing principal.payroll.write grant + missing
-- welfare_officer/inventory_officer/etc roles that this never actually ran against the live DB,
-- despite being committed and referenced as deployed in later commit messages. Applying it now.

create or replace function public.auth_school_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from school_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

revoke execute on function public.auth_school_user_id() from public, anon;
grant execute on function public.auth_school_user_id() to authenticated;

insert into public.roles (name, display_name, description)
select v.name, v.display_name, v.description
from (values
  ('admissions_officer', 'Admissions Officer', 'Onboarding wizard only — downstream module writes still need that module''s own permission (Section 7)'),
  ('academic_officer', 'Academic Officer', 'Academics and exam structure — not finance, medical, or discipline'),
  ('payroll_officer', 'Payroll Officer', 'Payroll only — kept separate from general Finance'),
  ('inventory_officer', 'Inventory/Procurement Officer', 'Inventory and procurement only'),
  ('welfare_officer', 'Counsellor/Welfare Officer', 'Discipline & Welfare only')
) as v(name, display_name, description)
where not exists (select 1 from public.roles where name = v.name);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('hostel.read_assigned'), ('hostel.write_assigned')) as perm(key)
where r.name = 'hostel_warden'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values
  ('library.read_any'), ('library.write'),
  ('transport.read_any'), ('transport.write'),
  ('hostel.read_any'), ('hostel.write'),
  ('payroll.read_any'), ('payroll.write'),
  ('inventory.read_any'), ('inventory.write')
) as perm(key)
where r.name in ('school_owner', 'principal')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values
  ('library.read_any'), ('transport.read_any'), ('hostel.read_any'), ('payroll.read_any'), ('inventory.read_any')
) as perm(key)
where r.name = 'deputy_principal'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('library.read_any'), ('library.write')) as perm(key)
where r.name = 'librarian'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('transport.read_any'), ('transport.write')) as perm(key)
where r.name = 'transport_manager'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('payroll.read_any'), ('payroll.write')) as perm(key)
where r.name = 'payroll_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('inventory.read_any'), ('inventory.write')) as perm(key)
where r.name = 'inventory_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('admissions.read_any'), ('admissions.write')) as perm(key)
where r.name = 'admissions_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('academics.read'), ('academics.write'), ('exams.read'), ('exams.write'), ('students.read')) as perm(key)
where r.name = 'academic_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('discipline.read_any'), ('discipline.write'), ('students.read')) as perm(key)
where r.name = 'welfare_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

drop policy if exists boarding_houses_select on public.boarding_houses;
create policy boarding_houses_select on public.boarding_houses
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and auth_school_user_id() in (master_id, assistant_id))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.dormitories d where d.house_id = boarding_houses.id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists boarding_houses_write on public.boarding_houses;
create policy boarding_houses_write on public.boarding_houses
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

drop policy if exists dormitories_select on public.dormitories;
create policy dormitories_select on public.dormitories
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and auth_school_user_id() in (master_id, assistant_id))
  );

drop policy if exists dormitories_write on public.dormitories;
create policy dormitories_write on public.dormitories
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and auth_school_user_id() in (master_id, assistant_id))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and auth_school_user_id() in (master_id, assistant_id))
  );

drop policy if exists hostel_rooms_select on public.hostel_rooms;
create policy hostel_rooms_select on public.hostel_rooms
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.dormitories d where d.id = hostel_rooms.dormitory_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists hostel_rooms_insert on public.hostel_rooms;
create policy hostel_rooms_insert on public.hostel_rooms
  for insert with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.dormitories d where d.id = hostel_rooms.dormitory_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists hostel_rooms_update on public.hostel_rooms;
create policy hostel_rooms_update on public.hostel_rooms
  for update using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.dormitories d where d.id = hostel_rooms.dormitory_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists beds_select on public.beds;
create policy beds_select on public.beds
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.hostel_rooms hr join public.dormitories d on d.id = hr.dormitory_id
      where hr.id = beds.room_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists beds_write on public.beds;
create policy beds_write on public.beds
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.hostel_rooms hr join public.dormitories d on d.id = hr.dormitory_id
      where hr.id = beds.room_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.hostel_rooms hr join public.dormitories d on d.id = hr.dormitory_id
      where hr.id = beds.room_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists hostel_allocations_select on public.hostel_allocations;
create policy hostel_allocations_select on public.hostel_allocations
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = hostel_allocations.bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists hostel_allocations_insert on public.hostel_allocations;
create policy hostel_allocations_insert on public.hostel_allocations
  for insert with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = hostel_allocations.bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists hostel_allocations_update on public.hostel_allocations;
create policy hostel_allocations_update on public.hostel_allocations
  for update using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = hostel_allocations.bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists boarding_transfers_select on public.boarding_transfers;
create policy boarding_transfers_select on public.boarding_transfers
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = boarding_transfers.to_bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists boarding_transfers_write on public.boarding_transfers;
create policy boarding_transfers_write on public.boarding_transfers
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = boarding_transfers.to_bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
    or (school_id = auth_school_id() and auth_has_permission('hostel.write_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = boarding_transfers.to_bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );
