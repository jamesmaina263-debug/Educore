-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918073452 -- reconstructed, not rewritten.

DROP POLICY IF EXISTS "payroll_records_select" ON public."payroll_records";
CREATE POLICY "payroll_records_select" ON public."payroll_records" AS PERMISSIVE FOR SELECT TO public USING (((school_id = auth_school_id()) AND auth_has_permission('payroll.read_any'::text)) OR (EXISTS ( SELECT 1
   FROM school_users su
  WHERE ((su.id = payroll_records.teacher_id) AND (su.auth_user_id = ( SELECT auth.uid() AS uid)) AND (su.school_id = payroll_records.school_id)))));

