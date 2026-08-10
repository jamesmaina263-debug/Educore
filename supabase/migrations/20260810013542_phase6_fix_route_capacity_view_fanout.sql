-- Fix: v_transport_route_capacity joined transport_vehicles AND
-- student_transport_assignments directly to transport_routes, which fans
-- out (N vehicles x M assignments rows) before aggregation, inflating both
-- the capacity sum and the allocated count. Found via live testing:
-- 2 vehicles (1+5=6 capacity) with 2 active assignments incorrectly showed
-- capacity=12, allocated=4. Fixed by aggregating each side independently
-- before joining onto the route.
create or replace view public.v_transport_route_capacity as
select
  r.id as route_id,
  r.school_id,
  r.name as route_name,
  coalesce(vcap.capacity, 0)::int as capacity,
  coalesce(acount.allocated, 0)::int as allocated,
  greatest(coalesce(vcap.capacity, 0)::int - coalesce(acount.allocated, 0)::int, 0) as available
from public.transport_routes r
left join (
  select route_id, sum(capacity) as capacity
  from public.transport_vehicles
  group by route_id
) vcap on vcap.route_id = r.id
left join (
  select route_id, count(*) as allocated
  from public.student_transport_assignments
  where status = 'active'
  group by route_id
) acount on acount.route_id = r.id;

alter view public.v_transport_route_capacity set (security_invoker = true);
