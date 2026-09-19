-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072849 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "competency_marks_write" ON public."competency_marks";
DROP POLICY IF EXISTS "competency_marks_select" ON public."competency_marks";
CREATE POLICY "competency_marks_insert" ON public."competency_marks" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN curriculum_sub_strands css ON ((css.id = competency_marks.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((st.id = competency_marks.student_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "competency_marks_delete" ON public."competency_marks" AS PERMISSIVE FOR DELETE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN curriculum_sub_strands css ON ((css.id = competency_marks.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((st.id = competency_marks.student_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "competency_marks_update" ON public."competency_marks" AS PERMISSIVE FOR UPDATE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN curriculum_sub_strands css ON ((css.id = competency_marks.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((st.id = competency_marks.student_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id))))))) WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN curriculum_sub_strands css ON ((css.id = competency_marks.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((st.id = competency_marks.student_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "competency_marks_select" ON public."competency_marks" AS PERMISSIVE FOR SELECT TO public USING (((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN curriculum_sub_strands css ON ((css.id = competency_marks.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((st.id = competency_marks.student_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id))))))) OR (( SELECT auth.role() AS role) = 'authenticated' AND ((((school_id = auth_school_id()) AND auth_has_permission('exams.read'::text)) OR (auth_user_id_is_guardian_of(student_id) AND (EXISTS ( SELECT 1
   FROM report_cards rc
  WHERE ((rc.exam_id = competency_marks.exam_id) AND (rc.student_id = competency_marks.student_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text])))))) OR ((EXISTS ( SELECT 1
   FROM (students st
     JOIN school_users su ON ((su.id = st.school_user_id)))
  WHERE ((st.id = competency_marks.student_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM report_cards rc
  WHERE ((rc.exam_id = competency_marks.exam_id) AND (rc.student_id = competency_marks.student_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text]))))))))));

