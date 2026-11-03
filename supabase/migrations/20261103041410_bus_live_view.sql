-- WP 5.3 (1/2): live bus view for school staff and parents. Additive only; dark behind flags.
--   * feature.transport.live_tracking (WP 5.1) must be on for ANY of this to return data.
--   * feature.transport.parent_bus_view (new here, off for everyone) separately switches on what parents see,
--     so a school can run tracking for staff first and open it to parents later, after the privacy review.
-- No existing table, policy, function, trigger or grant is changed.
--
-- Child-safety data. Rules built into the parent function, not left to the UI:
--   * only a guardian of that learner, in the same school, may ask;
--   * only the learner's own active transport assignment decides which vehicle is shown;
--   * a position is returned only while it is fresh (recorded in the last 10 minutes); otherwise the answer is
--     "not live" with NO coordinates, so a parked or off-duty vehicle is never located;
--   * the answer never contains the registration number, driver name or phone, other learners, or other stops.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.transport.parent_bus_view',
       'Parent bus view',
       'Lets guardians see where their child''s school bus is while it is moving (needs Vehicle live tracking too). Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.transport.parent_bus_view');

-- 2. Staff: every vehicle of the caller's school with its latest position (if any).
-- SECURITY INVOKER on purpose: the existing RLS policies on transport_vehicles, transport_routes and
-- vehicle_positions (transport.read_any of the own school) decide what the caller may see. Without that
-- permission, or with the live-tracking flag off, the result is empty.
create or replace function public.fleet_live_status()
returns table (
  vehicle_id uuid,
  registration_number text,
  route_name text,
  lat double precision,
  lng double precision,
  speed_kph real,
  heading real,
  accuracy_m real,
  recorded_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select v.id, v.registration_number, r.name, p.lat, p.lng, p.speed_kph, p.heading, p.accuracy_m, p.recorded_at
    from public.transport_vehicles v
    left join public.transport_routes r on r.id = v.route_id and r.school_id = v.school_id
    left join lateral (
      select vp.lat, vp.lng, vp.speed_kph, vp.heading, vp.accuracy_m, vp.recorded_at
        from public.vehicle_positions vp
       where vp.vehicle_id = v.id and vp.school_id = v.school_id
       order by vp.recorded_at desc
       limit 1
    ) p on true
   where v.school_id = public.auth_school_id()
     and public.my_school_has_feature_flag('feature.transport.live_tracking')
   order by v.registration_number;
$function$;

-- 3. Parent: where is my child's bus right now? Returns jsonb with a 'status':
--   forbidden | disabled | no_assignment | no_vehicle | not_live | live
create or replace function public.guardian_bus_status(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c_fresh constant interval := interval '10 minutes';
  v_school uuid := public.auth_school_id();
  v_student_school uuid;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_asg public.student_transport_assignments%rowtype;
  v_vehicle uuid;
  v_vehicle_count integer;
  v_route_name text;
  v_stop_name text;
  v_pos public.vehicle_positions%rowtype;
begin
  if auth.uid() is null or v_school is null or p_student_id is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  -- Guardian of THIS learner, and the learner belongs to the caller's school.
  if not public.auth_user_id_is_guardian_of(p_student_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select s.school_id into v_student_school from public.students s where s.id = p_student_id;
  if v_student_school is distinct from v_school then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if not (public.school_has_feature_flag(v_school, 'feature.transport.live_tracking')
          and public.school_has_feature_flag(v_school, 'feature.transport.parent_bus_view')) then
    return jsonb_build_object('status', 'disabled');
  end if;

  select a.* into v_asg
    from public.student_transport_assignments a
   where a.student_id = p_student_id
     and a.school_id = v_school
     and a.status = 'active'
     and a.start_date <= v_today
     and (a.end_date is null or a.end_date >= v_today)
   limit 1;
  if not found then
    return jsonb_build_object('status', 'no_assignment');
  end if;

  select r.name into v_route_name from public.transport_routes r where r.id = v_asg.route_id and r.school_id = v_school;
  if v_asg.stop_id is not null then
    select st.name into v_stop_name from public.transport_stops st where st.id = v_asg.stop_id and st.school_id = v_school;
  end if;

  -- The learner's own vehicle; if none was chosen, the route's vehicle but only when that is unambiguous.
  v_vehicle := v_asg.vehicle_id;
  if v_vehicle is null then
    select count(*), (array_agg(v.id))[1] into v_vehicle_count, v_vehicle
      from public.transport_vehicles v
     where v.school_id = v_school and v.route_id = v_asg.route_id;
    if v_vehicle_count is distinct from 1 then
      v_vehicle := null;
    end if;
  end if;
  if v_vehicle is null then
    return jsonb_build_object('status', 'no_vehicle',
                              'route', case when v_route_name is null then null else jsonb_build_object('name', v_route_name) end);
  end if;

  select vp.* into v_pos
    from public.vehicle_positions vp
   where vp.vehicle_id = v_vehicle and vp.school_id = v_school
   order by vp.recorded_at desc
   limit 1;

  if not found or v_pos.recorded_at < now() - c_fresh then
    -- Deliberately no coordinates and no "last seen" time: a stale position is not shared.
    return jsonb_build_object('status', 'not_live',
                              'route', case when v_route_name is null then null else jsonb_build_object('name', v_route_name) end,
                              'stop', v_stop_name);
  end if;

  return jsonb_build_object(
    'status', 'live',
    'route', case when v_route_name is null then null else jsonb_build_object('name', v_route_name) end,
    'stop', v_stop_name,
    'lat', round(v_pos.lat::numeric, 5),
    'lng', round(v_pos.lng::numeric, 5),
    'heading', v_pos.heading,
    'speed_kph', v_pos.speed_kph,
    'accuracy_m', v_pos.accuracy_m,
    'recorded_at', v_pos.recorded_at,
    'age_seconds', greatest(0, floor(extract(epoch from (now() - v_pos.recorded_at))))::integer
  );
end;
$function$;

-- 4. Grants. New functions get PUBLIC EXECUTE by default: remove it, then grant explicitly.
revoke all on function public.fleet_live_status() from public;
revoke execute on function public.fleet_live_status() from anon;
grant execute on function public.fleet_live_status() to authenticated;

revoke all on function public.guardian_bus_status(uuid) from public;
revoke execute on function public.guardian_bus_status(uuid) from anon;
grant execute on function public.guardian_bus_status(uuid) to authenticated;
