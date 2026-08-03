-- Phase 0, Step 2 (cont): auth helper functions + RLS policies
-- All functions are SECURITY DEFINER with a pinned search_path
-- (the mutable-search_path issue found in the POS codebase is not
-- getting repeated here).

create or replace function auth_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id
  from school_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace function auth_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from school_users su
    join roles r on r.id = su.role_id
    where su.auth_user_id = auth.uid()
      and su.status = 'active'
      and r.name = 'super_admin'
  );
$$;

-- Effective permission = per-school override if one exists for this role,
-- else the platform default row for this role.
create or replace function auth_has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select su.school_id, su.role_id
    from school_users su
    where su.auth_user_id = auth.uid()
      and su.status = 'active'
    limit 1
  ),
  override as (
    select rp.allowed
    from role_permissions rp, caller c
    where rp.role_id = c.role_id
      and rp.school_id = c.school_id
      and rp.permission_key = p_permission_key
  ),
  default_grant as (
    select rp.allowed
    from role_permissions rp, caller c
    where rp.role_id = c.role_id
      and rp.school_id is null
      and rp.permission_key = p_permission_key
  )
  select coalesce(
    (select allowed from override),
    (select allowed from default_grant),
    false
  );
$$;

-- attach the trigger created (function-only) in the prior migration
create trigger trg_school_users_prevent_escalation
  before update on school_users
  for each row execute function prevent_school_user_privilege_escalation();

-- ============================================================
-- RLS
-- ============================================================
alter table school_groups enable row level security;
alter table schools enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table school_users enable row level security;

-- school_groups: only relevant to super_admin and members of that group
create policy school_groups_select on school_groups
  for select
  using (
    auth_is_super_admin()
    or id in (select school_group_id from schools where id = auth_school_id())
  );

create policy school_groups_all_super_admin on school_groups
  for all
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

-- schools: read your own school; provisioning/deletion is a platform (super_admin) action
create policy schools_select on schools
  for select
  using (auth_is_super_admin() or id = auth_school_id());

create policy schools_update on schools
  for update
  using (
    auth_is_super_admin()
    or (id = auth_school_id() and auth_has_permission('settings.branding.write'))
  )
  with check (
    auth_is_super_admin()
    or (id = auth_school_id() and auth_has_permission('settings.branding.write'))
  );

create policy schools_insert_super_admin on schools
  for insert
  with check (auth_is_super_admin());

create policy schools_delete_super_admin on schools
  for delete
  using (auth_is_super_admin());

-- roles: reference data, readable by any authenticated school_user, writable by super_admin only
create policy roles_select on roles
  for select
  using (auth.role() = 'authenticated');

create policy roles_all_super_admin on roles
  for all
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

-- role_permissions: defaults are readable by all; overrides readable within your own school
create policy role_permissions_select on role_permissions
  for select
  using (
    auth_is_super_admin()
    or school_id is null
    or school_id = auth_school_id()
  );

create policy role_permissions_write_super_admin on role_permissions
  for all
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

create policy role_permissions_override_manage on role_permissions
  for all
  using (
    school_id = auth_school_id() and auth_has_permission('settings.roles.manage')
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('settings.roles.manage')
  );

-- school_users: tenant + permission scoped, per §6
create policy school_users_select on school_users
  for select
  using (auth_is_super_admin() or school_id = auth_school_id());

create policy school_users_insert on school_users
  for insert
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  );

create policy school_users_update on school_users
  for update
  using (
    auth_is_super_admin()
    or auth_user_id = auth.uid()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  )
  with check (
    auth_is_super_admin()
    or auth_user_id = auth.uid()
    or (school_id = auth_school_id() and auth_has_permission('staff.manage'))
  );

create policy school_users_delete on school_users
  for delete
  using (auth_is_super_admin());
