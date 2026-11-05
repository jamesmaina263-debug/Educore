-- WP 5.3 (bot part): "where is the bus" over the WhatsApp bot, database core. Additive only.
--   * No existing table, policy, function, trigger or grant is changed. No new flag: the bot answers only when the
--     school already has BOTH feature.transport.live_tracking AND feature.transport.parent_bus_view on (the same two
--     switches that gate the parent portal view, guardian_bus_status()).
--   * guardian_bus_status() cannot be reused by the bot: it reads auth.uid(), which is null for the service role.
--     These two functions repeat its rules with the guardian passed in explicitly, and are service_role only.
--   * Deliberately returns NO coordinates and no vehicle identity: the bot's reply is stored in the message log, so
--     the position itself stays on the portal map. Only "live / not live", route, stop and age in seconds.
-- Rollback: switch parent_bus_view off for the school (the bot stops answering), or
--   drop function public.bot_bus_enabled(uuid); drop function public.bot_guardian_bus_status(uuid, uuid, uuid);

-- 1. Is the bot allowed to answer bus questions for this school? (service role only)
create or replace function public.bot_bus_enabled(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.school_has_feature_flag(p_school_id, 'feature.transport.live_tracking'), false)
     and coalesce(public.school_has_feature_flag(p_school_id, 'feature.transport.parent_bus_view'), false);
$$;

-- 2. Status for one learner, for one guardian. status: forbidden | disabled | no_assignment | no_vehicle | not_live | live
create or replace function public.bot_guardian_bus_status(p_school_id uuid, p_guardian_user_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c_fresh constant interval := interval '10 minutes';
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_asg public.student_transport_assignments%rowtype;
  v_vehicle uuid;
  v_vehicle_count integer;
  v_route_name text;
  v_stop_name text;
  v_pos_at timestamptz;
begin
  if p_school_id is null or p_guardian_user_id is null or p_student_id is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  -- The guardian must be a parent of THIS school, linked to THIS learner, and the learner must be in this school.
  if not exists (
    select 1
      from public.school_users gu
      join public.student_guardians sg on sg.guardian_user_id = gu.id
      join public.students s on s.id = sg.student_id
     where gu.id = p_guardian_user_id
       and gu.school_id = p_school_id
       and gu.status = 'active'
       and sg.student_id = p_student_id
       and s.school_id = p_school_id
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if not public.bot_bus_enabled(p_school_id) then
    return jsonb_build_object('status', 'disabled');
  end if;

  select a.* into v_asg
    from public.student_transport_assignments a
   where a.student_id = p_student_id
     and a.school_id = p_school_id
     and a.status = 'active'
     and a.start_date <= v_today
     and (a.end_date is null or a.end_date >= v_today)
   limit 1;
  if not found then
    return jsonb_build_object('status', 'no_assignment');
  end if;

  select r.name into v_route_name from public.transport_routes r where r.id = v_asg.route_id and r.school_id = p_school_id;
  if v_asg.stop_id is not null then
    select st.name into v_stop_name from public.transport_stops st where st.id = v_asg.stop_id and st.school_id = p_school_id;
  end if;

  v_vehicle := v_asg.vehicle_id;
  if v_vehicle is null then
    select count(*), (array_agg(v.id))[1] into v_vehicle_count, v_vehicle
      from public.transport_vehicles v
     where v.school_id = p_school_id and v.route_id = v_asg.route_id;
    if v_vehicle_count is distinct from 1 then
      v_vehicle := null;
    end if;
  end if;
  if v_vehicle is null then
    return jsonb_build_object('status', 'no_vehicle', 'route', v_route_name);
  end if;

  select vp.recorded_at into v_pos_at
    from public.vehicle_positions vp
   where vp.vehicle_id = v_vehicle and vp.school_id = p_school_id
   order by vp.recorded_at desc
   limit 1;

  if v_pos_at is null or v_pos_at < now() - c_fresh then
    return jsonb_build_object('status', 'not_live', 'route', v_route_name, 'stop', v_stop_name);
  end if;

  return jsonb_build_object(
    'status', 'live',
    'route', v_route_name,
    'stop', v_stop_name,
    'age_seconds', greatest(0, floor(extract(epoch from (now() - v_pos_at))))::integer
  );
end;
$function$;

-- 3. Grants: service role only (new functions get PUBLIC EXECUTE by default).
revoke all on function public.bot_bus_enabled(uuid) from public, anon, authenticated;
grant execute on function public.bot_bus_enabled(uuid) to service_role;
revoke all on function public.bot_guardian_bus_status(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.bot_guardian_bus_status(uuid, uuid, uuid) to service_role;
