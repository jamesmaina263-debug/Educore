-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072535 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "subscription_plans_manage" ON public."subscription_plans";
DROP POLICY IF EXISTS "subscription_plans_select" ON public."subscription_plans";
CREATE POLICY "subscription_plans_insert" ON public."subscription_plans" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth_is_super_admin());
CREATE POLICY "subscription_plans_delete" ON public."subscription_plans" AS PERMISSIVE FOR DELETE TO authenticated USING (auth_is_super_admin());
CREATE POLICY "subscription_plans_update" ON public."subscription_plans" AS PERMISSIVE FOR UPDATE TO authenticated USING (auth_is_super_admin()) WITH CHECK (auth_is_super_admin());
CREATE POLICY "subscription_plans_select" ON public."subscription_plans" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth_is_super_admin()) OR (true));

