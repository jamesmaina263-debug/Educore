-- Reported: the Nurse can see the entire "Inventory & Procurement" module
-- (Stock, Assets, Suppliers, Procurement -- all of Main Store, every category,
-- every school department's items), when she should only see medical stock.
--
-- Root cause: migration 20260821201515 ("health_permissions_school_wide_defaults")
-- granted the Nurse role a school-wide default of inventory.read_any = true,
-- alongside health.read_any. That was collateral, not intentional -- the
-- migration's own comment says the goal was fixing the Health module's
-- all-or-nothing health.read_any gate; inventory.read_any was bundled in
-- because health_inventory_stock's select policy (from 20260813230000) accepts
-- *either* health.read_any *or* inventory.read_any, so granting inventory.read_any
-- also happened to satisfy it. But inventory.read_any is Main Store's own
-- blanket "view inventory" gate (src/app/(app)/inventory/_data.ts canReadAny),
-- used by inventory_items/inventory_categories/inventory_stock_movements/
-- suppliers/purchase_orders RLS -- granting it to the Nurse opened all of that,
-- not just her medical stock.
--
-- It was never actually needed: the Nurse's own view lives entirely at
-- /health/inventory, backed by health_inventory_stock, and that table's select
-- policy is already satisfied by health.read_any alone (which the Nurse
-- correctly has and keeps). Removing inventory.read_any changes nothing about
-- what she can already do in Health > Inventory, Sick Bay, Medication, etc.
--
-- Fix: set inventory.read_any = false for the Nurse role, everywhere it's
-- currently true -- the school-wide default (school_id is null) and any
-- per-school override -- so this is closed for every school, not just one.
-- Nothing else changes: inventory.write stays false (already revoked in
-- 20260813230000), inventory.health.issue stays true, health.read_any stays
-- true, and every other role's inventory.read_any is untouched.

update public.role_permissions
set allowed = false
where permission_key = 'inventory.read_any'
  and allowed = true
  and role_id in (select id from public.roles where name = 'nurse');
