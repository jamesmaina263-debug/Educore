-- Security fix: health_stock_adjustment_requests_insert had `with check (true)`,
-- relying entirely on request_health_stock_adjustment() (the intended entry point)
-- to enforce school scoping and the inventory.health.issue permission. That
-- function's checks never actually protect the table: PostgREST lets any
-- `authenticated` caller INSERT into health_stock_adjustment_requests directly
-- (e.g. POST /rest/v1/health_stock_adjustment_requests), bypassing the function
-- entirely. With check(true), that direct insert could carry ANY school_id,
-- item_id, quantity, reason, and requested_by -- a user in School A could plant
-- a forged adjustment request against School B (or against their own school
-- impersonating another requester), without holding inventory.health.issue at
-- all, for an approver to later approve unknowingly.
--
-- security definer functions in Supabase run as the function owner (postgres),
-- which has BYPASSRLS, so tightening this policy does not affect
-- request_health_stock_adjustment() -- it keeps working exactly as before.
-- This only closes the direct-table-write path.
drop policy if exists health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests;

create policy health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests
  for insert
  with check (
    school_id = auth_school_id()
    and auth_has_permission('inventory.health.issue')
    and exists (
      select 1 from public.inventory_items
      where id = item_id and school_id = auth_school_id()
    )
  );
