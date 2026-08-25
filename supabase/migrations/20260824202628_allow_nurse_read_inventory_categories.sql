-- The Health Inventory page looks up the "Medical Supplies" category to filter
-- both the Nurse's stock list and her pending-transfers list. That lookup goes
-- through inventory_categories, whose RLS only allowed inventory.read_any
-- holders to read it. The Nurse role has inventory.health.issue but not
-- inventory.read_any, so the lookup silently returned nothing for her --
-- hiding her entire medical inventory AND pending transfers, not just one
-- transfer. Category names aren't sensitive, so widen read access to anyone
-- who can touch health inventory, matching the same permission already used
-- to gate her writes.
drop policy if exists inventory_categories_select on public.inventory_categories;
create policy inventory_categories_select on public.inventory_categories
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('inventory.read_any') or auth_has_permission('inventory.health.issue')))
  );
