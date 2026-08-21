-- Issue 4: School Owner should always retain settings.roles.manage.
-- Previously user_permission_overrides (row-level, highest precedence) could
-- be written by anyone holding settings.roles.manage -- including against
-- the Owner's own school_user_id -- with no special-casing like the
-- super-admin bypass already used elsewhere. That let a second privileged
-- user lock the real Owner out of the Permissions module with no in-app way
-- to undo it. This special-cases settings.roles.manage for the school_owner
-- role the same way auth_is_super_admin() is special-cased: it always wins,
-- regardless of any override row that exists or gets written later.
CREATE OR REPLACE FUNCTION public.auth_has_permission(p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with caller as (
    select su.id as school_user_id, su.school_id, su.role_id, r.name as role_name
    from school_users su
    join roles r on r.id = su.role_id
    where su.auth_user_id = auth.uid()
      and su.status = 'active'
    limit 1
  ),
  user_override as (
    select upo.allowed
    from user_permission_overrides upo, caller c
    where upo.school_user_id = c.school_user_id
      and upo.permission_key = p_permission_key
  ),
  role_override as (
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
  select case
    when p_permission_key = 'settings.roles.manage'
      and exists (select 1 from caller c where c.role_name = 'school_owner')
    then true
    else coalesce(
      (select allowed from user_override),
      (select allowed from role_override),
      (select allowed from default_grant),
      false
    )
  end;
$function$;
