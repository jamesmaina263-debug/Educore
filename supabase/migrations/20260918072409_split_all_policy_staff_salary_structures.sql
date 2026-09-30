-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918072409 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "staff_salary_structures_write" ON public."staff_salary_structures";
DROP POLICY IF EXISTS "staff_salary_structures_select" ON public."staff_salary_structures";
CREATE POLICY "staff_salary_structures_insert" ON public."staff_salary_structures" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
CREATE POLICY "staff_salary_structures_delete" ON public."staff_salary_structures" AS PERMISSIVE FOR DELETE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
CREATE POLICY "staff_salary_structures_update" ON public."staff_salary_structures" AS PERMISSIVE FOR UPDATE TO public USING ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text)))) WITH CHECK ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
CREATE POLICY "staff_salary_structures_select" ON public."staff_salary_structures" AS PERMISSIVE FOR SELECT TO public USING (((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text)))) OR ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('payroll.read_any'::text) OR (staff_id = auth_school_user_id()))))));

