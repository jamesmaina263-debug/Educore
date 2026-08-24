-- Feature: the Nurse should be able to raise her own request for medical
-- supplies, which the owner/principal/deputy (inventory.procurement.approve
-- holders) approve, which then automatically emails the supplier -- exactly
-- the existing Requisition -> Purchase Order flow Main Store already uses,
-- just opened up to the Nurse for her own requests.
--
-- What's already true and needs no change (confirmed by reading the code):
--   * Approval is already required before anything is sent to a supplier --
--     purchase_orders_insert already requires inventory.procurement.approve,
--     enforced at the RLS level, not just the UI. There is no path that skips it.
--   * The supplier email is already automatic: createPurchaseOrderAction calls
--     queue_supplier_po_email the moment the approver issues the PO.
--   * Receiving is already store-only: goods are received against the PO by
--     whoever holds inventory.write (Main Store), never the Nurse -- she was
--     never able to receive directly, and this migration doesn't change that.
--   * Store -> Nurse handoff after receiving is already the existing "Transfer
--     to Health" / Accept flow (20260813230000) -- untouched here.
--
-- What's missing: the Nurse currently has neither of the two permissions this
-- flow requires to even raise a request --
--   * purchase_requisitions_insert requires inventory.write, which she no
--     longer holds (rightly revoked in 20260813230000 -- it's Main Store's
--     unrestricted add/remove permission, far broader than "let me ask for
--     supplies").
--   * The requisition line item itself (purchase_requisition_items) is a "for
--     all" (insert/update/delete) policy also gated on inventory.write.
--   * Beyond that, /inventory/procurement (where requisitions are raised in
--     the UI today) is the same route as Main Store's Stock/Assets/Suppliers
--     pages, gated on inventory.read_any -- which she also no longer holds,
--     and shouldn't, since that's the very thing that let her see all of
--     Main Store in the first place.
--
-- Fix: a new, narrow permission -- health.procurement.request -- that only
-- lets her create a requisition (header + line item) for herself, and only
-- ever her own. She is not given purchase_orders/purchase_order_items access
-- at all (that stays inventory.read_any / inventory.procurement.approve, as
-- today) -- she doesn't need to see the PO or supplier details, only whether
-- her request was approved, which purchase_requisitions_select already lets
-- her see (its existing "or requested_by = auth_school_user_id()" clause).
-- The actual UI for this lives on Health > Inventory, not /inventory/procurement,
-- so nothing about her page access changes either.

-- 1. Grant the new permission to the Nurse role, school-wide default, same
--    pattern as every other Nurse permission grant in this codebase.
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'health.procurement.request', true
from public.roles r
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'health.procurement.request'
  );

-- 2. Let a health.procurement.request holder create a requisition header for
--    herself. inventory.write keeps working exactly as before for Main Store.
drop policy if exists purchase_requisitions_insert on public.purchase_requisitions;
create policy purchase_requisitions_insert on public.purchase_requisitions for insert
  with check (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.write')
        or (auth_has_permission('health.procurement.request') and requested_by = auth_school_user_id())
      )
    )
  );

-- 3. Let her attach/edit/remove the line item(s) on a requisition, but only on
--    a requisition she herself raised -- never anyone else's. inventory.write
--    holders are unaffected: they can still write any requisition's items,
--    exactly as before.
drop policy if exists purchase_requisition_items_write on public.purchase_requisition_items;
create policy purchase_requisition_items_write on public.purchase_requisition_items for all
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.write')
        or (
          auth_has_permission('health.procurement.request')
          and exists (
            select 1 from public.purchase_requisitions r
            where r.id = purchase_requisition_items.requisition_id and r.requested_by = auth_school_user_id()
          )
        )
      )
    )
  )
  with check (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.write')
        or (
          auth_has_permission('health.procurement.request')
          and exists (
            select 1 from public.purchase_requisitions r
            where r.id = purchase_requisition_items.requisition_id and r.requested_by = auth_school_user_id()
          )
        )
      )
    )
  );
