-- ============================================================
-- Phase 6: Transport Module Completion
-- Stops (route-level capacity granularity), vehicle capacity
-- enforcement at assignment time, driver/conductor/licence/
-- insurance/inspection tracking, and live capacity views that
-- Admissions Step 7 reads from ("Route A — 38/40, 2 spaces available").
-- Extends the existing transport_routes/transport_vehicles/
-- student_transport_assignments tables — no parallel schema.
-- ============================================================

-- 1. Stops: a route has an ordered list of stops. Capacity is optional
-- per stop (a school may only care about route-level capacity) — when
-- null, the stop itself never blocks assignment, only the route/vehicle
-- capacity does.
create table public.transport_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  route_id uuid not null references public.transport_routes(id) on delete cascade,
  name text not null,
  sequence int not null default 1,
  pickup_time time,
  capacity int check (capacity is null or capacity > 0),
  created_at timestamptz not null default now(),
  unique (route_id, name)
);

create index idx_transport_stops_route on public.transport_stops(route_id);

alter table public.transport_stops enable row level security;

create policy transport_stops_select on public.transport_stops
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.read_any')));
create policy transport_stops_insert on public.transport_stops
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));
create policy transport_stops_update on public.transport_stops
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));
create policy transport_stops_delete on public.transport_stops
  for delete using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));

-- 2. Vehicles: driver/conductor/licence/insurance/inspection tracking
-- (Brief 4.10 — audit flagged vehicles as driver_name/driver_phone only).
alter table public.transport_vehicles
  add column if not exists conductor_name text,
  add column if not exists conductor_phone text,
  add column if not exists driver_license_number text,
  add column if not exists driver_license_expiry date,
  add column if not exists insurance_expiry date,
  add column if not exists inspection_expiry date,
  add column if not exists status text not null default 'active';

alter table public.transport_vehicles
  add constraint transport_vehicles_status_check check (status in ('active', 'maintenance', 'inactive'));

-- 3. Assignments: reference a specific stop (in addition to the existing
-- free-text pickup_point, kept for schools that haven't configured stops yet).
alter table public.student_transport_assignments
  add column if not exists stop_id uuid references public.transport_stops(id);

create index idx_student_transport_assignments_stop on public.student_transport_assignments(stop_id) where status = 'active';
create index idx_student_transport_assignments_route_active on public.student_transport_assignments(route_id) where status = 'active';
create index idx_student_transport_assignments_vehicle_active on public.student_transport_assignments(vehicle_id) where status = 'active';

-- 4. Live capacity views — what Admissions Step 7 reads from.
-- Route capacity = sum of capacities of vehicles assigned to that route
-- (a route with no vehicles yet shows capacity 0, allocated 0).
create or replace view public.v_transport_route_capacity as
select
  r.id as route_id,
  r.school_id,
  r.name as route_name,
  coalesce(sum(v.capacity), 0)::int as capacity,
  count(a.id) filter (where a.status = 'active')::int as allocated,
  greatest(coalesce(sum(v.capacity), 0)::int - count(a.id) filter (where a.status = 'active')::int, 0) as available
from public.transport_routes r
left join public.transport_vehicles v on v.route_id = r.id
left join public.student_transport_assignments a on a.route_id = r.id and a.status = 'active'
group by r.id, r.school_id, r.name;

create or replace view public.v_transport_stop_capacity as
select
  s.id as stop_id,
  s.school_id,
  s.route_id,
  s.name as stop_name,
  s.sequence,
  s.capacity,
  count(a.id) filter (where a.status = 'active')::int as allocated,
  case when s.capacity is null then null else greatest(s.capacity - count(a.id) filter (where a.status = 'active')::int, 0) end as available
from public.transport_stops s
left join public.student_transport_assignments a on a.stop_id = s.id and a.status = 'active'
group by s.id, s.school_id, s.route_id, s.name, s.sequence, s.capacity;

alter view public.v_transport_route_capacity set (security_invoker = true);
alter view public.v_transport_stop_capacity set (security_invoker = true);

-- 5. Capacity-aware assignment: replaces the previous version of
-- assign_transport, which never checked capacity at all. Now enforces,
-- in order: route capacity (if the route has any vehicles), vehicle
-- capacity (if a specific vehicle was chosen), and stop capacity (if the
-- stop has a configured limit). Raises a clear, specific exception per
-- constraint so the UI can surface exactly which one was hit.
-- The old 4-arg signature is dropped first — a 5th param with a default
-- creates a distinct overload in Postgres rather than replacing it, which
-- would leave the old, capacity-blind version callable side by side.
drop function if exists public.assign_transport(uuid, uuid, uuid, text);

create or replace function public.assign_transport(
  p_student_id uuid,
  p_route_id uuid,
  p_vehicle_id uuid,
  p_pickup_point text,
  p_stop_id uuid default null
)
returns public.student_transport_assignments
language plpgsql security definer set search_path to 'public'
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

  if not exists (select 1 from transport_routes where id = p_route_id and school_id = v_school_id) then
    raise exception 'route not found in this school';
  end if;

  if p_vehicle_id is not null and not exists (select 1 from transport_vehicles where id = p_vehicle_id and school_id = v_school_id) then
    raise exception 'vehicle not found in this school';
  end if;

  if p_stop_id is not null and not exists (select 1 from transport_stops where id = p_stop_id and route_id = p_route_id and school_id = v_school_id) then
    raise exception 'stop not found on this route';
  end if;

  -- Route capacity: only enforced once the route has at least one vehicle
  -- assigned (capacity 0 with no vehicles means "not yet configured", not "full").
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

revoke all on function public.assign_transport(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.assign_transport(uuid, uuid, uuid, text, uuid) to authenticated;
