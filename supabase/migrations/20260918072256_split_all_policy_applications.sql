-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072256 -- reconstructed, not rewritten.

-- ===== applications =====
DROP POLICY IF EXISTS "applications_write" ON public."applications";
DROP POLICY IF EXISTS "applications_select" ON public."applications";
CREATE POLICY "applications_insert" ON public."applications" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));
CREATE POLICY "applications_delete" ON public."applications" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));
CREATE POLICY "applications_update" ON public."applications" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));
CREATE POLICY "applications_select" ON public."applications" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.read_any'::text)) OR ((guardian_id IS NOT NULL) AND (guardian_id = ( SELECT school_users.id
   FROM school_users
  WHERE ((school_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (school_users.status = 'active'::text))))))));

