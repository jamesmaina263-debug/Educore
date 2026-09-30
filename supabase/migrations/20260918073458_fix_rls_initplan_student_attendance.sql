-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918073458 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "student_attendance_select" ON public."student_attendance";
CREATE POLICY "student_attendance_select" ON public."student_attendance" AS PERMISSIVE FOR SELECT TO public USING (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('attendance.mark_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('attendance.mark'::text) AND auth_user_is_class_teacher_of_stream(stream_id)) OR (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('attendance.read'::text)) OR auth_user_id_is_guardian_of(student_id) OR (EXISTS ( SELECT 1
   FROM (students st
     JOIN school_users su ON ((su.id = st.school_user_id)))
  WHERE ((st.id = student_attendance.student_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid)))))));

