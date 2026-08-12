-- Phase 14: RBAC/RLS Hardening & Cross-Module Access Testing (Brief Section 7, Section 9)
--
-- Findings from a full audit of every role_permissions grant across all 30+ prior migrations:
--
-- 1. SEVERE, confirmed bug: Library, Transport, and Hostel/Boarding were each built with their
--    schema, RLS, and write-functions fully gated behind permission keys (library.read_any/write,
--    transport.read_any/write, hostel.read_any/write) — but NONE of those keys were ever granted
--    to ANY role, anywhere, including school_owner/principal. Same for payroll.read_any/write and
--    inventory.read_any/write (inventory.write was granted to nurse only, for medical supplies —
--    never to anyone for general school inventory). Net effect: five entire modules have been
--    inaccessible to every real staff role since they were built. This migration is the fix.
--
-- 2. Section 7's representative role list names several roles that don't exist yet: Admissions
--    Officer, Academic Officer, Payroll Officer, Inventory/Procurement Officer, Counsellor/Welfare
--    Officer (Bursar already covers "Finance Officer"). Adding them now, with narrow permission
--    sets — per Section 7's explicit instruction that an Admissions Officer "is not automatically
--    granted every module's full permission set," the same restraint applies to the others: each
--    gets only its own module's keys, nothing broader.
--
-- 3. Confirmed gap from the Phase 1 audit, now fixable: `hostel_warden` exists as a role but was
--    never granted anything, and had no way to be scoped to specific dormitories even if it were
--    (Phase 5's own comment explicitly deferred this: "renaming permission keys school-wide is a
--    bigger, separate concern than this phase" — Phase 5 already added boarding_houses.master_id/
--    assistant_id and dormitories.master_id/assistant_id for exactly this, just never wired RLS to
--    use them). Adds new scoped permission keys (hostel.read_assigned/write_assigned) and RLS that
--    checks them against those existing master_id/assistant_id columns — no new assignment table
--    needed, the structure was already there.
--
-- Not in this migration's scope (flagged, not silently skipped): boarding_incidents has no
-- dormitory/bed column to scope by (only student_id) — leaving it at school-wide hostel.read_any
-- for now rather than adding a join through hostel_allocations that could go stale after a
-- transfer. General "create a custom role from the UI" configurability (beyond the per-school
-- permission override role_permissions already supports) is a new feature, not a hardening fix,
-- and is out of scope here.

-- ----------------------------------------------------------------------------
-- Helper: current staff row id, same pattern as auth_school_id()/auth_is_super_admin().
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- New roles (Section 7's representative list, minus Bursar which already covers Finance
-- Officer). Each gets only its own module — never a neighboring module's permissions.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- New scoped Boarding permission keys, granted to Hostel Warden instead of the school-wide
-- _any variants — matches its role description, "Hostel module + own boarders".
-- ----------------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values ('hostel.read_assigned'), ('hostel.write_assigned')) as perm(key)
where r.name = 'hostel_warden'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

-- ----------------------------------------------------------------------------
-- Fix: grant the never-granted module permissions. school_owner/principal get full read+write
-- on every module (matches their existing "full access across the school" description).
-- deputy_principal gets read-only on these (matches its existing "read-only elsewhere").
-- The dedicated specialist roles get read+write on their own module only.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Dormitory-scoped Boarding RLS: a holder of hostel.read_assigned/write_assigned (Hostel Warden)
-- sees/edits only houses/dormitories/rooms/beds/allocations where they're master_id or
-- assistant_id on the house or the dormitory — never the whole school's boarding data.
-- ----------------------------------------------------------------------------
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

-- boarding_transfers: scoped the same way, via to_bed_id (the destination dormitory is the one
-- that matters for a warden's own-dormitory boundary).
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
