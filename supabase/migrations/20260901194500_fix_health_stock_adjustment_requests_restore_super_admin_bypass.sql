-- Corrective follow-up to 20260901172320_fix_health_stock_adjustment_requests_insert_check.sql.
--
-- That migration was written without checking for later migrations overriding
-- the same policy, and it unknowingly duplicated a fix already shipped in
-- 20260825180315_fix_health_stock_adjustment_requests_insert_policy.sql (six
-- days earlier). Worse, it regressed that existing fix: it dropped the
-- correct policy (school scope + permission + auth_is_super_admin() bypass,
-- matching the established inventory_transfers_insert pattern) and replaced
-- it with one missing the super_admin bypass, which would have broken
-- super-admin access to this workflow once deployed.
--
-- This restores the super_admin bypass while keeping the one genuinely new
-- piece of hardening from 20260901172320 (verifying item_id belongs to the
-- caller's school), since neither prior version checked that.
drop policy if exists health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests;

create policy health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests
  for insert
  with check (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('inventory.health.issue')
      and exists (
        select 1 from public.inventory_items
        where id = item_id and school_id = auth_school_id()
      )
    )
  );
