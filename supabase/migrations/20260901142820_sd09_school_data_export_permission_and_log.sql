-- SD-09 (GTM Readiness Protocol): school-level data export.
-- Grants a new permission key so a school owner can pull their own school's core
-- operational data out (students, guardians, staff, academic structure, finance) —
-- data portability, not day-to-day reporting (which already has per-module exports).

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'settings.data_export', true
from public.roles r
where r.name = 'school_owner'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'settings.data_export'
  );

-- SECURITY DEFINER logger so a bulk PII export always leaves an audit trail, the
-- same way every other sensitive action in this app does. Re-checks the permission
-- itself (not just trusting the caller already checked it client-side) so this can
-- never be used to plant a false "export happened" entry, nor can it be skipped by
-- a caller that has UI access but somehow lost the permission mid-session.
create or replace function public.log_school_data_export(p_dataset_names text[], p_row_counts jsonb)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_user_id uuid;
  v_school_id uuid;
begin
  if not auth_has_permission('settings.data_export') then
    raise exception 'not authorized to export school data';
  end if;

  select su.id, su.school_id into v_school_user_id, v_school_id
  from school_users su
  where su.auth_user_id = auth.uid()
    and su.status = 'active'
  limit 1;

  if v_school_id is null then
    raise exception 'no active school context for caller';
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (
    v_school_id,
    v_school_user_id,
    'school_data_export',
    v_school_id,
    'export',
    'Full school data export (' || array_length(p_dataset_names, 1) || ' datasets)',
    jsonb_build_object('datasets', p_dataset_names, 'row_counts', p_row_counts)
  );
end;
$$;

grant execute on function public.log_school_data_export(text[], jsonb) to authenticated;
