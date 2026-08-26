-- Fix broken access control: the insert policy for health_stock_adjustment_requests
-- was created with `with check (true)`, allowing any authenticated user from any
-- school to insert fabricated stock-adjustment requests into another school's
-- approval queue. Tighten to match the inventory_transfers_insert pattern:
-- require the caller to be scoped to the target school and hold the relevant
-- permission (or be a super admin).

drop policy if exists health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests;

create policy health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests
  for insert
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('inventory.health.issue'))
  );
