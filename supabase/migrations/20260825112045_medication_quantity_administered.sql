-- James: administerMedication's stock deduction always called issue_health_stock with
-- p_quantity hardcoded to 1, regardless of how many units were actually given (e.g. "2
-- tablets") -- the real amount only ever landed in the free-text dosage field, so stock
-- silently drifted from reality on every multi-unit dose. Fixing the deduction itself is a
-- frontend/RPC-argument change (no schema change needed there, issue_health_stock already
-- takes p_quantity), but adding a proper structured column here so the exact number of units
-- deducted is on the administration record itself, not just re-derivable from parsing the
-- free-text dosage string.

alter table public.medication_administrations
  add column quantity_administered int check (quantity_administered is null or quantity_administered > 0);

comment on column public.medication_administrations.quantity_administered is
  'Number of inventory units (in the item''s own unit -- tablets, sachets, etc.) actually deducted from health_inventory_stock for this dose. Null when inventory_item_id is null (untracked medication) or for historical rows recorded before this column existed, both of which predate real per-unit deduction.';
