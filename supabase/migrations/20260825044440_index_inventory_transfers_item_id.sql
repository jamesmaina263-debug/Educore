-- Supports the EXISTS lookup in inventory_items_health_select (evaluated per-row
-- on inventory_items reads for health.issue holders). Table is tiny today so this
-- isn't urgent, but it's the right index for the query pattern and costs nothing.
create index if not exists inventory_transfers_item_id_idx on public.inventory_transfers (item_id);
