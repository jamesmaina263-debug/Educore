-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072400 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "roles_all_super_admin" ON public."roles";
DROP POLICY IF EXISTS "roles_select" ON public."roles";
CREATE POLICY "roles_insert" ON public."roles" AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth_is_super_admin());
CREATE POLICY "roles_delete" ON public."roles" AS PERMISSIVE FOR DELETE TO public USING (auth_is_super_admin());
CREATE POLICY "roles_update" ON public."roles" AS PERMISSIVE FOR UPDATE TO public USING (auth_is_super_admin()) WITH CHECK (auth_is_super_admin());
CREATE POLICY "roles_select" ON public."roles" AS PERMISSIVE FOR SELECT TO public USING ((auth_is_super_admin()) OR ((( SELECT auth.role() AS role) = 'authenticated'::text)));

