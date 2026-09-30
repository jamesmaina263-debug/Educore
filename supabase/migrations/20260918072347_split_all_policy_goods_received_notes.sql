-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072347 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "goods_received_notes_write" ON public."goods_received_notes";
DROP POLICY IF EXISTS "goods_received_notes_select" ON public."goods_received_notes";
CREATE POLICY "goods_received_notes_insert" ON public."goods_received_notes" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_notes_delete" ON public."goods_received_notes" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_notes_update" ON public."goods_received_notes" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
CREATE POLICY "goods_received_notes_select" ON public."goods_received_notes" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.read_any'::text)))));

