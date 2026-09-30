-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072509 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "rubrics_write" ON public."rubrics";
DROP POLICY IF EXISTS "rubrics_select" ON public."rubrics";
CREATE POLICY "rubrics_insert" ON public."rubrics" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubrics_delete" ON public."rubrics" AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubrics_update" ON public."rubrics" AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
CREATE POLICY "rubrics_select" ON public."rubrics" AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) OR ((EXISTS ( SELECT 1
   FROM (curriculum_sub_strands css
     JOIN curriculum_strands cs ON ((cs.id = css.strand_id)))
  WHERE ((css.id = rubrics.sub_strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.read'::text))))))));

