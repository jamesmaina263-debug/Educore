-- Phase 7: medical inventory needs expiry tracking (Brief 4.2: "quantity,
-- expiry, low-stock alerts") which the existing Inventory module didn't
-- have. Adding it to inventory_items (nullable — only perishable items like
-- medical supplies need it) rather than a separate medical-inventory table,
-- per "use the existing Inventory module" instruction.
alter table public.inventory_items add column if not exists expiry_date date;
