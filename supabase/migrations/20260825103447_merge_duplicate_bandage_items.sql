-- Merge 3 duplicate "crept bandage(s)" items into the original canonical item
-- "Bandages (roll)" (which already has real transfer history and 15 units in
-- Health's stock). Re-point every record that references a duplicate so
-- nothing is orphaned, fold in the 200 units that were added to one of the
-- duplicates in Main Store, then remove the empty duplicate rows.

-- Re-point the rejected transfer attached to "crept bandages" so its history
-- stays attached to the real item.
update public.inventory_transfers
set item_id = '64cb88a3-45dc-4afc-86ab-b82fa87ace6f'
where item_id = 'c1592fcb-e5cc-45bc-b7fe-5e828ff05e76';

-- Re-point the 200-unit "in" movement recorded against the duplicate
-- "Crept bandage" so the audit trail stays with the real item.
update public.inventory_stock_movements
set item_id = '64cb88a3-45dc-4afc-86ab-b82fa87ace6f'
where item_id = '44394579-a6ae-4988-8fb3-794a79526b87';

-- Fold the 200 units into the canonical item's Main Store quantity (matches
-- the re-pointed movement above exactly, so no separate audit row needed).
update public.inventory_items
set quantity = quantity + 200, updated_at = now()
where id = '64cb88a3-45dc-4afc-86ab-b82fa87ace6f';

-- Remove the now-empty duplicates (no other table referenced them: no PO
-- lines, no health_inventory_stock rows).
delete from public.inventory_items
where id in ('c1592fcb-e5cc-45bc-b7fe-5e828ff05e76', '44394579-a6ae-4988-8fb3-794a79526b87', '581dd270-0132-43d6-8b30-179cf44f349c');
