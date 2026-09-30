-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072458 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "rubric_level_descriptors_write" ON public."rubric_level_descriptors";
DROP POLICY IF EXISTS "rubric_level_descriptors_select" ON public."rubric_level_descriptors";
CREATE POLICY "rubric_level_descriptors_insert" ON public."rubric_level_descriptors" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_level_descriptors_delete" ON public."rubric_level_descriptors" AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_level_descriptors_update" ON public."rubric_level_descriptors" AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_level_descriptors_select" ON public."rubric_level_descriptors" AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) OR ((EXISTS ( SELECT 1
   FROM (((rubric_criteria rc
     JOIN rubrics r ON ((r.id = rc.rubric_id)))
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((rc.id = rubric_level_descriptors.criterion_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.read'::text))))))));

