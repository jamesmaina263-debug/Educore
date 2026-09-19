-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072355 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "role_permissions_write" ON public."role_permissions";
DROP POLICY IF EXISTS "role_permissions_select" ON public."role_permissions";
CREATE POLICY "role_permissions_insert" ON public."role_permissions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)) OR auth_is_super_admin()));
CREATE POLICY "role_permissions_delete" ON public."role_permissions" AS PERMISSIVE FOR DELETE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)) OR auth_is_super_admin()));
CREATE POLICY "role_permissions_update" ON public."role_permissions" AS PERMISSIVE FOR UPDATE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)) OR auth_is_super_admin())) WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)) OR auth_is_super_admin()));
CREATE POLICY "role_permissions_select" ON public."role_permissions" AS PERMISSIVE FOR SELECT TO public USING (((((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)) OR auth_is_super_admin())) OR ((auth_is_super_admin() OR (school_id IS NULL) OR (school_id = auth_school_id()))));

