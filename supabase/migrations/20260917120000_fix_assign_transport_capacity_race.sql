-- assign_transport()'s vehicle-capacity check locks the specific vehicle row
-- (`for update`) before counting, so two concurrent calls for the same
-- vehicle correctly serialize. But the route-capacity and stop-capacity
-- checks read from v_transport_route_capacity / v_transport_stop_capacity,
-- both GROUP BY aggregate views with no single row to lock -- so those two
-- checks have no locking at all. p_vehicle_id is optional (confirmed in
-- assignTransportAction(), src/app/(app)/transport/actions.ts, which passes
-- input.vehicle_id || null), so the common case of assigning a student to a
-- route + pickup point without picking a specific vehicle runs with zero
-- concurrency protection anywhere in the function: two staff assigning
-- different students to the same route at the same moment can both read
-- "1 seat left," both pass the check, and both insert -- overbooking the
-- route past what the vehicle can actually carry, discovered only on the
-- day. There's no DB-level backstop either -- confirmed no unique
-- constraint limits how many active student_transport_assignments can
-- point at one route_id or stop_id (only plain, non-unique indexes exist:
-- idx_student_transport_assignments_route_active,
-- idx_student_transport_assignments_stop).
--
-- A capacity limit like this is a limit on an aggregate (a SUM/COUNT), not
-- on a single row, so there's no natural row to `for update` the way the
-- vehicle check, allocate_bed, and allocate_hostel_room all do for their
-- single-row resources. The standard fix for serializing around an
-- aggregate with no natural lockable row is a transaction-scoped advisory
-- lock keyed on the aggregate's identity (here, the route/stop id) --
-- concurrent calls for the *same* route or stop now queue up and see each
-- other's inserts before checking capacity; different routes/stops are
-- unaffected and don't block each other. The lock is released automatically
-- at commit or rollback, same as the row locks used elsewhere in this
-- function, so nothing about cleanup or error handling changes.
--
-- Nothing else about the function changes: same permission check, same
-- existence checks, same vehicle-lock pattern, same end-then-insert
-- reassignment logic.

create or replace function public.assign_transport(
  p_student_id uuid,
  p_route_id uuid,
  p_vehicle_id uuid,
  p_pickup_point text,
  p_stop_id uuid default null
)
returns student_transport_assignments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.student_transport_assignments;
  v_route_capacity int;
  v_route_allocated int;
  v_vehicle_capacity int;
  v_vehicle_allocated int;
  v_stop_capacity int;
  v_stop_allocated int;
begin
  if not auth_has_permission('transport.write') then
    raise exception 'insufficient permissions: transport.write required';
  end if;

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
  end if;

  if not exists (select 1 from transport_routes where id = p_route_id and school_id = v_school_id) then
    raise exception 'route not found in this school';
  end if;

  if p_vehicle_id is not null and not exists (select 1 from transport_vehicles where id = p_vehicle_id and school_id = v_school_id) then
    raise exception 'vehicle not found in this school';
  end if;

  if p_stop_id is not null and not exists (select 1 from transport_stops where id = p_stop_id and route_id = p_route_id and school_id = v_school_id) then
    raise exception 'stop not found on this route';
  end if;

  -- Serialize concurrent assignments to this route before reading its
  -- (unlockable, aggregate) capacity view -- see migration header.
  perform pg_advisory_xact_lock(hashtext('assign_transport:route:' || p_route_id::text));

  select capacity, allocated into v_route_capacity, v_route_allocated
  from v_transport_route_capacity where route_id = p_route_id;

  if v_route_capacity > 0 and v_route_allocated >= v_route_capacity then
    raise exception 'route is at full capacity (%/% seats taken)', v_route_allocated, v_route_capacity;
  end if;

  if p_vehicle_id is not null then
    select capacity into v_vehicle_capacity from transport_vehicles where id = p_vehicle_id for update;
    select count(*) into v_vehicle_allocated from student_transport_assignments where vehicle_id = p_vehicle_id and status = 'active';
    if v_vehicle_allocated >= v_vehicle_capacity then
      raise exception 'vehicle is at full capacity (%/% seats taken)', v_vehicle_allocated, v_vehicle_capacity;
    end if;
  end if;

  if p_stop_id is not null then
    -- Same reasoning as the route lock above, keyed on the stop instead.
    perform pg_advisory_xact_lock(hashtext('assign_transport:stop:' || p_stop_id::text));

    select capacity, allocated into v_stop_capacity, v_stop_allocated from v_transport_stop_capacity where stop_id = p_stop_id;
    if v_stop_capacity is not null and v_stop_allocated >= v_stop_capacity then
      raise exception 'stop is at full capacity (%/% seats taken)', v_stop_allocated, v_stop_capacity;
    end if;
  end if;

  update student_transport_assignments
  set status = 'ended', end_date = current_date
  where student_id = p_student_id and status = 'active' and school_id = v_school_id;

  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, pickup_point, stop_id)
  values (v_school_id, p_student_id, p_route_id, p_vehicle_id, p_pickup_point, p_stop_id)
  returning * into v_result;

  return v_result;
end;
$$;
