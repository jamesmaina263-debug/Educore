-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072324 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "competency_indicator_ratings_write" ON public."competency_indicator_ratings";
DROP POLICY IF EXISTS "competency_indicator_ratings_select" ON public."competency_indicator_ratings";
CREATE POLICY "competency_indicator_ratings_insert" ON public."competency_indicator_ratings" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.id = competency_indicator_ratings.student_id) AND auth_user_is_class_teacher_of_stream(st.current_class_id)))))));
CREATE POLICY "competency_indicator_ratings_delete" ON public."competency_indicator_ratings" AS PERMISSIVE FOR DELETE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.id = competency_indicator_ratings.student_id) AND auth_user_is_class_teacher_of_stream(st.current_class_id)))))));
CREATE POLICY "competency_indicator_ratings_update" ON public."competency_indicator_ratings" AS PERMISSIVE FOR UPDATE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.id = competency_indicator_ratings.student_id) AND auth_user_is_class_teacher_of_stream(st.current_class_id))))))) WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.id = competency_indicator_ratings.student_id) AND auth_user_is_class_teacher_of_stream(st.current_class_id)))))));
CREATE POLICY "competency_indicator_ratings_select" ON public."competency_indicator_ratings" AS PERMISSIVE FOR SELECT TO public USING (((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.write'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.id = competency_indicator_ratings.student_id) AND auth_user_is_class_teacher_of_stream(st.current_class_id))))))) OR ((((school_id = auth_school_id()) AND auth_has_permission('competency_ratings.read'::text)) OR (auth_user_id_is_guardian_of(student_id) AND (EXISTS ( SELECT 1
   FROM (report_cards rc
     JOIN exams e ON ((e.id = rc.exam_id)))
  WHERE ((rc.student_id = competency_indicator_ratings.student_id) AND (e.term_id = competency_indicator_ratings.term_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text])))))) OR ((EXISTS ( SELECT 1
   FROM (students st
     JOIN school_users su ON ((su.id = st.school_user_id)))
  WHERE ((st.id = competency_indicator_ratings.student_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM (report_cards rc
     JOIN exams e ON ((e.id = rc.exam_id)))
  WHERE ((rc.student_id = competency_indicator_ratings.student_id) AND (e.term_id = competency_indicator_ratings.term_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text])))))))));

