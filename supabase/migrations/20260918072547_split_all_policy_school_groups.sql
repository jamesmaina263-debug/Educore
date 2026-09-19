-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072547 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "school_groups_all_super_admin" ON public."school_groups";
DROP POLICY IF EXISTS "school_groups_select_privileged" ON public."school_groups";
DROP POLICY IF EXISTS "school_groups_update_group_admin" ON public."school_groups";
CREATE POLICY "school_groups_insert" ON public."school_groups" AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth_is_super_admin());
CREATE POLICY "school_groups_delete" ON public."school_groups" AS PERMISSIVE FOR DELETE TO public USING (auth_is_super_admin());
CREATE POLICY "school_groups_update" ON public."school_groups" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin()) OR (((id = auth_group_id()) AND auth_has_permission('group.branding.write'::text)))) WITH CHECK ((auth_is_super_admin()) OR (((id = auth_group_id()) AND auth_has_permission('group.branding.write'::text))));
CREATE POLICY "school_groups_select" ON public."school_groups" AS PERMISSIVE FOR SELECT TO public USING ((auth_is_super_admin()) OR ((auth_is_super_admin() OR ((id = auth_group_id()) AND (auth_has_permission('group.branding.write'::text) OR auth_has_permission('group.reports.read'::text))))));

