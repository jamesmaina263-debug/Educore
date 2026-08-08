-- Phase 5 Item 1: Multi-campus. school_group_id already existed on schools/school_users
-- (pre-scaffolded, unused). This migration activates it: a new group_admin system role,
-- scope enforcement, and a read-only cross-campus summary function.
--
-- Design decision (documented, same convention as Phase 3/4 judgment calls): v1 group_admin
-- gets READ-ONLY cross-campus visibility via one summary function, not blanket RLS access to
-- every operational table (attendance, marks, medical_records, payments etc). Opening every
-- table's RLS to a second scope dimension is a large blast-radius change for a persona need
-- (Part B: visibility without chasing staff for numbers) that a small number of aggregate
-- views/functions already satisfies. Full cross-campus staff/student directory access is a
-- real, stated v1 limit for a future phase, not silently dropped.
--
-- Design decision: a school_users row is scoped to exactly one of {school_id, school_group_id,
-- neither (super_admin)}. A person who is both a specific campus's Owner AND the group's admin
-- needs two school_users rows under two logins in v1 -- same "no fixed trigger, ask what's next"
-- pragmatism as the blueprint's own Phase 5 framing. Flagged, not solved, here.

insert into public.roles (name, display_name, description, is_system_role)
values ('group_admin', 'Group Admin', 'Cross-campus read-only visibility for a school_group: enrollment, fee collection, attendance, across all schools in the group. Not an operational role at any single campus.', true)
on conflict (name) do nothing;

-- Extend scope-enforcement trigger: group_admin must have school_id NULL and
-- school_group_id NOT NULL. All other non-super_admin roles unchanged (school_id required).
create or replace function public.enforce_school_user_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_role_name text;
begin
  select name into v_role_name from roles where id = new.role_id;
  if v_role_name = 'super_admin' then
    if new.school_id is not null then
      raise exception 'super_admin accounts must not be scoped to a single school_id';
    end if;
  elsif v_role_name = 'group_admin' then
    if new.school_id is not null then
      raise exception 'group_admin accounts must not be scoped to a single school_id';
    end if;
    if new.school_group_id is null then
      raise exception 'school_group_id is required for group_admin accounts';
    end if;
  else
    if new.school_id is null then
      raise exception 'school_id is required for all roles except super_admin and group_admin';
    end if;
  end if;
  return new;
end;
$function$;

-- Mirrors auth_school_id(): returns the caller's group scope, only if they hold an
-- active group_admin row. Returns null for everyone else (including school-scoped staff).
create or replace function public.auth_group_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $function$
  select su.school_group_id
  from school_users su
  join roles r on r.id = su.role_id
  where su.auth_user_id = auth.uid()
    and su.status = 'active'
    and r.name = 'group_admin'
  limit 1;
$function$;

-- Default permission grants for group_admin (school_id null = platform default row,
-- same convention as every other role's baseline grants).
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, perm, true
from public.roles r
cross join (values ('group.reports.read'), ('group.branding.write')) as p(perm)
where r.name = 'group_admin'
on conflict do nothing;

-- schools: group_admin can now see (not edit) every campus in their own group.
create policy schools_select_group_admin
on public.schools
for select
using (school_group_id = public.auth_group_id());

-- school_groups: group_admin can see and update their own group (branding fields land
-- in the white-label migration; this policy covers the row generally, gated by
-- group.branding.write for UPDATE specifically via a second policy below).
create policy school_groups_select_group_admin
on public.school_groups
for select
using (id = public.auth_group_id());

create policy school_groups_update_group_admin
on public.school_groups
for update
using (id = public.auth_group_id() and public.auth_has_permission('group.branding.write'))
with check (id = public.auth_group_id() and public.auth_has_permission('group.branding.write'));
