-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072529 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "subject_catalogue_super_admin_write" ON public."subject_catalogue";
DROP POLICY IF EXISTS "subject_catalogue_select" ON public."subject_catalogue";
CREATE POLICY "subject_catalogue_insert" ON public."subject_catalogue" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth_is_super_admin());
CREATE POLICY "subject_catalogue_delete" ON public."subject_catalogue" AS PERMISSIVE FOR DELETE TO authenticated USING (auth_is_super_admin());
CREATE POLICY "subject_catalogue_update" ON public."subject_catalogue" AS PERMISSIVE FOR UPDATE TO authenticated USING (auth_is_super_admin()) WITH CHECK (auth_is_super_admin());
CREATE POLICY "subject_catalogue_select" ON public."subject_catalogue" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth_is_super_admin()) OR (true));

