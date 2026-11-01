-- Phase 1.1d (database half): read the C2B mode status and switch the mode, for the finance screen.
-- ADDITIVE ONLY: two new functions. No table, policy, trigger, grant or existing function is touched.
-- mpesa_c2b_config stays closed to authenticated users (it holds the URL secret); these SECURITY
-- DEFINER functions are the only door, and neither selects or returns confirmation_token.
--
-- Rollback: the screen is hidden unless feature.finance.c2b_capture is on (it is on for 0 schools), so
-- nothing calls these yet. To remove: drop function public.c2b_mode_status(uuid);
-- drop function public.c2b_set_mode(uuid, text);

-- 1. Status: does a config row exist, which mode, is the URL registered. Never returns the token.
create or replace function public.c2b_mode_status(p_school_id uuid)
returns table (cfg_exists boolean, cfg_mode text, cfg_registered boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or p_school_id is null then
    return;
  end if;
  if not (
    public.auth_is_super_admin()
    or (p_school_id = public.auth_school_id() and public.auth_has_permission('finance.read'))
  ) then
    return;
  end if;
  -- Flag off => behave as if the feature does not exist (no rows, no information).
  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.finance.c2b_capture'), false) then
    return;
  end if;

  return query
    select true, c.mode, c.registered_at is not null
    from public.mpesa_c2b_config c
    where c.school_id = p_school_id
    union all
    select false, null::text, false
    where not exists (select 1 from public.mpesa_c2b_config c2 where c2.school_id = p_school_id);
end;
$function$;

comment on function public.c2b_mode_status(uuid) is
  'C2B mode for the finance screen. Finance readers of the school or a platform admin; empty result when the flag is off or the caller is not allowed. Never returns confirmation_token.';

-- 2. Switch the mode. Only an active school owner of that school, or a platform admin.
create or replace function public.c2b_set_mode(p_school_id uuid, p_mode text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cfg public.mpesa_c2b_config%rowtype;
  v_is_admin boolean;
  v_is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_school_id is null or p_mode is null or p_mode not in ('log_only', 'live') then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;

  v_is_admin := coalesce(public.auth_is_super_admin(), false);
  v_is_owner := exists (
    select 1 from public.school_users su join public.roles r on r.id = su.role_id
    where su.school_id = p_school_id and su.auth_user_id = auth.uid()
      and r.name = 'school_owner' and su.status = 'active'
  );
  if not (v_is_admin or v_is_owner) then
    raise exception 'Only the school owner or a platform admin can change the C2B mode.' using errcode = '42501';
  end if;

  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.finance.c2b_capture'), false) then
    raise exception 'Paybill auto-capture is not enabled for this school.' using errcode = '42501';
  end if;

  select * into v_cfg from public.mpesa_c2b_config where school_id = p_school_id for update;
  if not found then
    raise exception 'Paybill auto-capture has not been set up for this school yet.' using errcode = 'P0002';
  end if;

  if v_cfg.mode = p_mode then
    return v_cfg.mode;  -- nothing to change, nothing to audit
  end if;

  if p_mode = 'live' and v_cfg.registered_at is null then
    raise exception 'Cannot go live: the confirmation URL has not been registered with Safaricom.' using errcode = '55000';
  end if;

  update public.mpesa_c2b_config set mode = p_mode where school_id = p_school_id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
  values (
    p_school_id,
    (select su.id from public.school_users su where su.auth_user_id = auth.uid() and su.school_id = p_school_id and su.status = 'active' limit 1),
    'mpesa_c2b_config', p_school_id, 'c2b_set_mode',
    jsonb_build_object('mode', v_cfg.mode),
    jsonb_build_object('mode', p_mode, 'actor_auth_user_id', auth.uid(), 'actor_is_platform_admin', v_is_admin)
  );

  return p_mode;
end;
$function$;

comment on function public.c2b_set_mode(uuid, text) is
  'Switch C2B mode between log_only and live. School owner of that school or platform admin only; flag must be on; config row must exist; live requires registered_at. Writes its own audit_log row. Never reads or returns confirmation_token.';

revoke all on function public.c2b_mode_status(uuid) from public;
revoke execute on function public.c2b_mode_status(uuid) from anon;
grant execute on function public.c2b_mode_status(uuid) to authenticated;

revoke all on function public.c2b_set_mode(uuid, text) from public;
revoke execute on function public.c2b_set_mode(uuid, text) from anon;
grant execute on function public.c2b_set_mode(uuid, text) to authenticated;
