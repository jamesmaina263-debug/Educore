CREATE OR REPLACE FUNCTION public.respond_to_permission_request(p_request_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_reviewer uuid := auth_school_user_id();
  v_permission_key text;
  v_target_school_user_id uuid;
begin
  if not auth_has_permission('settings.roles.manage') then
    raise exception 'Not authorized to manage permission requests.';
  end if;

  select permission_key, school_user_id into v_permission_key, v_target_school_user_id
  from permission_requests
  where id = p_request_id and school_id = v_school_id and status = 'pending';

  if v_permission_key is null then
    raise exception 'Request not found or not pending.';
  end if;

  if p_approve and not auth_has_permission(v_permission_key) then
    raise exception 'You can''t grant a permission you don''t hold yourself.';
  end if;

  update permission_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = v_reviewer,
      reviewed_at = now()
  where id = p_request_id;

  if p_approve then
    insert into user_permission_overrides (school_id, school_user_id, permission_key, allowed, granted_by)
    values (v_school_id, v_target_school_user_id, v_permission_key, true, v_reviewer)
    on conflict (school_user_id, permission_key) do update set allowed = true, granted_by = v_reviewer;
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (
    v_school_id, v_reviewer, 'permission_requests', p_request_id,
    case when p_approve then 'approve' else 'reject' end,
    jsonb_build_object('permission_key', v_permission_key, 'status', case when p_approve then 'approved' else 'rejected' end)
  );
end;
$function$;
