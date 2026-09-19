-- Part 11. inventory_items had 2 SELECT-only permissive policies. Literal
-- OR, copied verbatim. Applied directly to production via Supabase MCP
-- during the audit and verified live.
drop policy inventory_items_health_select on public.inventory_items;
drop policy inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
  for select
  using (
    (
      auth_has_permission('inventory.health.issue')
      and school_id = auth_school_id()
      and (
        category_id in (select inventory_categories.id from inventory_categories where inventory_categories.name = 'Medical Supplies' and inventory_categories.school_id = auth_school_id())
        or exists (select 1 from inventory_transfers t where t.item_id = inventory_items.id and t.school_id = auth_school_id())
      )
    )
    or (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')))
  );
