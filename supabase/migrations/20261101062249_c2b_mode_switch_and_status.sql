-- Phase 1.1d (gap-closure plan), DATABASE HALF: C2B mode switch + read-only status. ADDITIVE ONLY.
--
-- Adds two new functions and nothing else. No existing table, function, policy, trigger or grant is
-- touched. mpesa_c2b_config keeps NO policies and NO grants for anon/authenticated: its
-- confirmation_token is a URL secret, so these SECURITY DEFINER functions are the only way a
-- signed-in user can reach the table, and neither one ever selects or returns the token.
--
--   * public.set_c2b_mode(p_school_id, p_mode)  -- switch a school between 'log_only' and 'live'.
--       Allowed for: an active school_owner of THAT school, or a platform super admin
--       (auth_is_super_admin(), which already enforces MFA). Approved by the owner of the programme.
--       Requires the feature flag feature.finance.c2b_capture to be on for the school.
--       Refuses when no config row exists. Refuses 'live' unless registered_at is set, i.e. a URL
--       registration has succeeded (approved guard). Writes one audit_log row per real change.
--       Calling it with the mode the school already has is a no-op (no write, no audit row).
--   * public.c2b_my_status()  -- what the Finance screen needs: whether the feature is on for the
--       caller's own school, the current mode, whether the URL is registered, and whether the
--       caller may switch the mode. Fails closed: flag off, no school, or no finance.read all
--       return {"enabled": false} and nothing else.
--
-- Rollback: switch the flag off (the screen disappears and set_c2b_mode refuses), or drop both
-- functions. Neither is called by anything until the UI PR ships.

create or replace function public.set_c2b_mode(p_school_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_super boolean;
  v_actor_su uuid;
  v_old_mode text;
  v_registered_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;
  if p_school_id is null then
    raise exception 'School is required.';
  end if;
  if p_mode is null or p_mode not in ('log_only', 'live') then
    raise exception 'Invalid mode.';
  end if;

  -- Permission first, so a caller who may not act on this school learns nothing about it.
  v_is_super := coalesce(public.auth_is_super_admin(), false);
  if not v_is_super then
    select su.id
      into v_actor_su
      from public.school_users su
      join public.roles r on r.id = su.role_id
     where su.auth_user_id = v_uid
       and su.status = 'active'
       and su.school_id = p_school_id
       and r.name = 'school_owner'
     limit 1;
    if v_actor_su is null then
      raise exception 'Not permitted.';
    end if;
  end if;

  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.finance.c2b_capture'), false) then
    raise exception 'This feature is not enabled for the school.';
  end if;

  -- Never select confirmation_token: only the two columns this function needs.
  select c.mode, c.registered_at
    into v_old_mode, v_registered_at
    from public.mpesa_c2b_config c
   where c.school_id = p_school_id
     for update;
  if not found then
    raise exception 'C2B is not set up for this school.';
  end if;

  if p_mode = 'live' and v_registered_at is null then
    raise exception 'Register the C2B URL before switching to live.';
  end if;

  if v_old_mode = p_mode then
    return jsonb_build_object('school_id', p_school_id, 'mode', v_old_mode, 'changed', false);
  end if;

  update public.mpesa_c2b_config
     set mode = p_mode
   where school_id = p_school_id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
  values (
    p_school_id,
    v_actor_su,
    'mpesa_c2b_config',
    p_school_id,
    'c2b_mode_change',
    jsonb_build_object('mode', v_old_mode),
    jsonb_build_object(
      'mode', p_mode,
      'actor_auth_user_id', v_uid,
      'actor_kind', case when v_is_super then 'platform_admin' else 'school_owner' end
    )
  );

  return jsonb_build_object('school_id', p_school_id, 'mode', p_mode, 'changed', true);
end;
$function$;

revoke all on function public.set_c2b_mode(uuid, text) from public;
revoke all on function public.set_c2b_mode(uuid, text) from anon;
grant execute on function public.set_c2b_mode(uuid, text) to authenticated;

create or replace function public.c2b_my_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_school uuid;
  v_mode text;
  v_registered_at timestamptz;
  v_found boolean := false;
  v_can_switch boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('enabled', false);
  end if;

  v_school := public.auth_school_id();
  if v_school is null then
    return jsonb_build_object('enabled', false);
  end if;

  if not coalesce(public.school_has_feature_flag(v_school, 'feature.finance.c2b_capture'), false) then
    return jsonb_build_object('enabled', false);
  end if;

  if not coalesce(public.auth_has_permission('finance.read'), false) then
    return jsonb_build_object('enabled', false);
  end if;

  -- Never select confirmation_token.
  select c.mode, c.registered_at
    into v_mode, v_registered_at
    from public.mpesa_c2b_config c
   where c.school_id = v_school;
  v_found := found;

  select exists (
    select 1
      from public.school_users su
      join public.roles r on r.id = su.role_id
     where su.auth_user_id = v_uid
       and su.status = 'active'
       and su.school_id = v_school
       and r.name = 'school_owner'
  ) into v_can_switch;

  return jsonb_build_object(
    'enabled', true,
    'configured', v_found,
    'mode', v_mode,
    'registered', v_registered_at is not null,
    'can_switch', v_can_switch
  );
end;
$function$;

revoke all on function public.c2b_my_status() from public;
revoke all on function public.c2b_my_status() from anon;
grant execute on function public.c2b_my_status() to authenticated;
