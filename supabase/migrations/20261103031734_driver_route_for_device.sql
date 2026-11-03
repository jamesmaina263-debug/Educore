-- WP 5.2 (1/2): what a driver's phone may see about its own route. Additive; dark behind
-- feature.transport.live_tracking (the flag created by WP 5.1). No table changes.
--
-- The driver phone authenticates with the tracker device token from WP 5.1 (only its SHA-256 hash reaches the
-- database). This function is service_role only: it is called by the app's /api/driver/route handler after
-- hashing the bearer token. Data minimisation (child-safety data): it returns the vehicle registration, the route
-- name, the route's stops in order with pickup times, and HOW MANY learners ride from each stop -- never a learner
-- name, id, guardian or phone number. Names for a driver roster need the privacy review noted in the roadmap.

create or replace function public.driver_route_for_device(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dev public.vehicle_tracker_devices%rowtype;
  v_veh public.transport_vehicles%rowtype;
  v_route_name text;
  v_stops jsonb;
  v_unstopped integer;
  v_total integer;
begin
  select * into v_dev from public.vehicle_tracker_devices where token_hash = p_token_hash and active;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.school_has_feature_flag(v_dev.school_id, 'feature.transport.live_tracking') then
    return jsonb_build_object('status', 'disabled');
  end if;

  select * into v_veh from public.transport_vehicles where id = v_dev.vehicle_id and school_id = v_dev.school_id;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  select r.name into v_route_name from public.transport_routes r where r.id = v_veh.route_id and r.school_id = v_dev.school_id;

  -- Active riders of this vehicle: assigned to it, or to its route with no vehicle chosen yet.
  with riders as (
    select a.stop_id
      from public.student_transport_assignments a
     where a.school_id = v_dev.school_id
       and a.status = 'active'
       and (a.vehicle_id = v_veh.id or (a.vehicle_id is null and v_veh.route_id is not null and a.route_id = v_veh.route_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', s.name,
           'sequence', s.sequence,
           'pickup_time', to_char(s.pickup_time, 'HH24:MI'),
           'riders', (select count(*) from riders rd where rd.stop_id = s.id)
         ) order by s.sequence, s.name), '[]'::jsonb)
    into v_stops
    from public.transport_stops s
   where s.school_id = v_dev.school_id and s.route_id = v_veh.route_id;

  select count(*) filter (where a.stop_id is null), count(*)
    into v_unstopped, v_total
    from public.student_transport_assignments a
   where a.school_id = v_dev.school_id
     and a.status = 'active'
     and (a.vehicle_id = v_veh.id or (a.vehicle_id is null and v_veh.route_id is not null and a.route_id = v_veh.route_id));

  return jsonb_build_object(
    'status', 'ok',
    'vehicle', jsonb_build_object('registration_number', v_veh.registration_number, 'capacity', v_veh.capacity),
    'route', case when v_route_name is null then null else jsonb_build_object('name', v_route_name) end,
    'stops', v_stops,
    'riders_without_stop', v_unstopped,
    'riders_total', v_total,
    'device_label', v_dev.label
  );
end;
$function$;

revoke all on function public.driver_route_for_device(text) from public, anon, authenticated;
grant execute on function public.driver_route_for_device(text) to service_role;
