-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260918073210 -- reconstructed, not rewritten.

CREATE INDEX IF NOT EXISTS idx_marketing_demo_requests_assigned_to ON public.marketing_demo_requests USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_remark_bank_entries_created_by ON public.remark_bank_entries USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_school_feature_flags_flag_id ON public.school_feature_flags USING btree (flag_id);

