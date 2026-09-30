-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072427 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "fee_waivers_manage" ON public."fee_waivers";
DROP POLICY IF EXISTS "fee_waivers_select" ON public."fee_waivers";
CREATE POLICY "fee_waivers_insert" ON public."fee_waivers" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((school_id = auth_school_id()) AND auth_has_permission('discounts.approve'::text)));
CREATE POLICY "fee_waivers_delete" ON public."fee_waivers" AS PERMISSIVE FOR DELETE TO authenticated USING (((school_id = auth_school_id()) AND auth_has_permission('discounts.approve'::text)));
CREATE POLICY "fee_waivers_update" ON public."fee_waivers" AS PERMISSIVE FOR UPDATE TO authenticated USING (((school_id = auth_school_id()) AND auth_has_permission('discounts.approve'::text))) WITH CHECK (((school_id = auth_school_id()) AND auth_has_permission('discounts.approve'::text)));
CREATE POLICY "fee_waivers_select" ON public."fee_waivers" AS PERMISSIVE FOR SELECT TO authenticated USING ((((school_id = auth_school_id()) AND auth_has_permission('discounts.approve'::text))) OR ((((school_id = auth_school_id()) AND auth_has_permission('finance.read'::text)) OR auth_user_id_is_guardian_of(student_id) OR (EXISTS ( SELECT 1
   FROM (students st
     JOIN school_users su ON ((su.id = st.school_user_id)))
  WHERE ((st.id = fee_waivers.student_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid))))))));

