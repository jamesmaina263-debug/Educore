-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072333 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "discipline_incident_staff_write" ON public."discipline_incident_staff";
DROP POLICY IF EXISTS "discipline_incident_staff_select" ON public."discipline_incident_staff";
CREATE POLICY "discipline_incident_staff_insert" ON public."discipline_incident_staff" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.write'::text))));
CREATE POLICY "discipline_incident_staff_delete" ON public."discipline_incident_staff" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.write'::text))));
CREATE POLICY "discipline_incident_staff_update" ON public."discipline_incident_staff" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.write'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.write'::text))));
CREATE POLICY "discipline_incident_staff_select" ON public."discipline_incident_staff" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.write'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('discipline.read_any'::text) OR auth_has_permission('discipline.write'::text))))));

