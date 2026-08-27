-- PO-2026-00002 line "paracetamol syrup 100ml" received 12 units on 2026-08-24,
-- but the PO line was created in "Custom item" mode instead of picked from the
-- stock catalog, so inventory_item_id was never set and record_goods_received
-- correctly (per its current logic) had nothing to post to. The item does
-- exist in the catalog (id 9cd4620f-b10c-4918-85da-e74a310071a7, currently 0).
-- This corrects both: links the PO line retroactively for accurate history,
-- and posts the missing 12 units with a clear audit trail.
update public.purchase_order_items
set inventory_item_id = '9cd4620f-b10c-4918-85da-e74a310071a7'
where id = 'cca57fc7-edb1-435c-97f5-64ec6dd33bbc';

update public.inventory_items
set quantity = quantity + 12, updated_at = now()
where id = '9cd4620f-b10c-4918-85da-e74a310071a7';

insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason)
values (
  '1dea95ea-c9b6-46da-9c07-aba712c84d61',
  '9cd4620f-b10c-4918-85da-e74a310071a7',
  'in',
  12,
  'Backfill: goods received against PO-2026-00002 on 2026-08-24 but never posted to stock because the PO line was not linked to this catalog item at creation time. Corrected retroactively.'
);
