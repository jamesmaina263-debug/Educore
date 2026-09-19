-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072340 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "goods_received_items_write" ON public."goods_received_items";
DROP POLICY IF EXISTS "goods_received_items_select" ON public."goods_received_items";
CREATE POLICY "goods_received_items_insert" ON public."goods_received_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_items_delete" ON public."goods_received_items" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_items_update" ON public."goods_received_items" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_items_select" ON public."goods_received_items" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.read_any'::text)))));

