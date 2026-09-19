-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072311 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "biometric_devices_all" ON public."biometric_devices";
DROP POLICY IF EXISTS "biometric_devices_select_for_enrollers" ON public."biometric_devices";
CREATE POLICY "biometric_devices_insert" ON public."biometric_devices" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('biometric.devices_manage'::text))));
CREATE POLICY "biometric_devices_delete" ON public."biometric_devices" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('biometric.devices_manage'::text))));
CREATE POLICY "biometric_devices_update" ON public."biometric_devices" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('biometric.devices_manage'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('biometric.devices_manage'::text))));
CREATE POLICY "biometric_devices_select" ON public."biometric_devices" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('biometric.devices_manage'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('biometric.enroll'::text) OR auth_has_permission('biometric.view'::text))))));

