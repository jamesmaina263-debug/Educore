-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072433 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "platform_invoices_manage" ON public."platform_invoices";
DROP POLICY IF EXISTS "platform_invoices_select" ON public."platform_invoices";
CREATE POLICY "platform_invoices_insert" ON public."platform_invoices" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth_is_super_admin());
CREATE POLICY "platform_invoices_delete" ON public."platform_invoices" AS PERMISSIVE FOR DELETE TO authenticated USING (auth_is_super_admin());
CREATE POLICY "platform_invoices_update" ON public."platform_invoices" AS PERMISSIVE FOR UPDATE TO authenticated USING (auth_is_super_admin()) WITH CHECK (auth_is_super_admin());
CREATE POLICY "platform_invoices_select" ON public."platform_invoices" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth_is_super_admin()) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('billing.read'::text)))));

