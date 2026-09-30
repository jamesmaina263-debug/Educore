-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072523 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "staff_attendance_write" ON public."staff_attendance";
DROP POLICY IF EXISTS "staff_attendance_select" ON public."staff_attendance";
CREATE POLICY "staff_attendance_insert" ON public."staff_attendance" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.mark'::text))));
CREATE POLICY "staff_attendance_delete" ON public."staff_attendance" AS PERMISSIVE FOR DELETE TO authenticated USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.mark'::text))));
CREATE POLICY "staff_attendance_update" ON public."staff_attendance" AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.mark'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.mark'::text))));
CREATE POLICY "staff_attendance_select" ON public."staff_attendance" AS PERMISSIVE FOR SELECT TO authenticated USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.mark'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.read_any'::text)) OR (EXISTS ( SELECT 1
   FROM school_users su
  WHERE ((su.id = staff_attendance.staff_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid))))))));

