-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072445 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "rubric_criteria_write" ON public."rubric_criteria";
DROP POLICY IF EXISTS "rubric_criteria_select" ON public."rubric_criteria";
CREATE POLICY "rubric_criteria_insert" ON public."rubric_criteria" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_criteria_delete" ON public."rubric_criteria" AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_criteria_update" ON public."rubric_criteria" AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubric_criteria_select" ON public."rubric_criteria" AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) OR ((EXISTS ( SELECT 1
   FROM ((rubrics r
     JOIN curriculum_sub_strands css ON ((css.id = r.sub_strand_id)))
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((r.id = rubric_criteria.rubric_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.read'::text))))))));

