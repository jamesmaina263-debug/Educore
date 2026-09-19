-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072932 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "rubric_criterion_scores_write" ON public."rubric_criterion_scores";
DROP POLICY IF EXISTS "rubric_criterion_scores_select" ON public."rubric_criterion_scores";
CREATE POLICY "rubric_criterion_scores_insert" ON public."rubric_criterion_scores" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM (((competency_marks cm
     JOIN students st ON ((st.id = cm.student_id)))
     JOIN curriculum_sub_strands css ON ((css.id = cm.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "rubric_criterion_scores_delete" ON public."rubric_criterion_scores" AS PERMISSIVE FOR DELETE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM (((competency_marks cm
     JOIN students st ON ((st.id = cm.student_id)))
     JOIN curriculum_sub_strands css ON ((css.id = cm.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "rubric_criterion_scores_update" ON public."rubric_criterion_scores" AS PERMISSIVE FOR UPDATE TO public USING ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM (((competency_marks cm
     JOIN students st ON ((st.id = cm.student_id)))
     JOIN curriculum_sub_strands css ON ((css.id = cm.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id))))))) WITH CHECK ((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM (((competency_marks cm
     JOIN students st ON ((st.id = cm.student_id)))
     JOIN curriculum_sub_strands css ON ((css.id = cm.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)))))));
CREATE POLICY "rubric_criterion_scores_select" ON public."rubric_criterion_scores" AS PERMISSIVE FOR SELECT TO public USING (((((school_id = auth_school_id()) AND auth_has_permission('marks.write_any'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('marks.write'::text) AND (EXISTS ( SELECT 1
   FROM (((competency_marks cm
     JOIN students st ON ((st.id = cm.student_id)))
     JOIN curriculum_sub_strands css ON ((css.id = cm.sub_strand_id)))
     JOIN curriculum_strands cst ON ((cst.id = css.strand_id)))
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id))))))) OR (( SELECT auth.role() AS role) = 'authenticated' AND ((((school_id = auth_school_id()) AND auth_has_permission('exams.read'::text)) OR (EXISTS ( SELECT 1
   FROM competency_marks cm
  WHERE ((cm.id = rubric_criterion_scores.competency_mark_id) AND ((auth_user_id_is_guardian_of(cm.student_id) AND (EXISTS ( SELECT 1
           FROM report_cards rc
          WHERE ((rc.exam_id = cm.exam_id) AND (rc.student_id = cm.student_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text])))))) OR ((EXISTS ( SELECT 1
           FROM (students st
             JOIN school_users su ON ((su.id = st.school_user_id)))
          WHERE ((st.id = cm.student_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
           FROM report_cards rc
          WHERE ((rc.exam_id = cm.exam_id) AND (rc.student_id = cm.student_id) AND (rc.comment_source = ANY (ARRAY['teacher_approved'::text, 'teacher_written'::text]))))))))))))));

