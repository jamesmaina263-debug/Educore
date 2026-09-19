-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072515 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "school_subscriptions_manage" ON public."school_subscriptions";
DROP POLICY IF EXISTS "school_subscriptions_select" ON public."school_subscriptions";
CREATE POLICY "school_subscriptions_insert" ON public."school_subscriptions" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth_is_super_admin());
CREATE POLICY "school_subscriptions_delete" ON public."school_subscriptions" AS PERMISSIVE FOR DELETE TO authenticated USING (auth_is_super_admin());
CREATE POLICY "school_subscriptions_update" ON public."school_subscriptions" AS PERMISSIVE FOR UPDATE TO authenticated USING (auth_is_super_admin()) WITH CHECK (auth_is_super_admin());
CREATE POLICY "school_subscriptions_select" ON public."school_subscriptions" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth_is_super_admin()) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('billing.read'::text)))));

