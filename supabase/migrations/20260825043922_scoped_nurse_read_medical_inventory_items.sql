-- revoke_nurse_main_inventory_read (from a parallel session, #16) correctly
-- revoked inventory.read_any from the Nurse role so she can't browse all of
-- Main Store's catalog. But inventory_items' RLS SELECT policy required
-- inventory.read_any for ANY read, so it also silently blocked her from
-- seeing her own Medical Supplies items and the item details joined into her
-- pending-transfers list -- breaking both sections of her Health > Inventory
-- page as collateral damage.
--
-- This adds a scoped, additive read policy: a health.issue holder can read
-- an inventory_items row only if it's in the "Medical Supplies" category for
-- her school, or it's the subject of a transfer to/from her school. This does
-- not reopen the rest of Main Store's catalog to her.
create policy inventory_items_health_select on public.inventory_items
  for select
  using (
    auth_has_permission('inventory.health.issue')
    and school_id = auth_school_id()
    and (
      category_id in (
        select id from public.inventory_categories
        where name = 'Medical Supplies' and school_id = auth_school_id()
      )
      or exists (
        select 1 from public.inventory_transfers t
        where t.item_id = inventory_items.id and t.school_id = auth_school_id()
      )
    )
  );
