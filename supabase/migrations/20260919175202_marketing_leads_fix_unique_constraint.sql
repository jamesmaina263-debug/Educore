-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260919175202 -- reconstructed, not rewritten.

drop index if exists public.marketing_leads_email_lower_idx;
alter table public.marketing_leads add constraint marketing_leads_email_key unique (email);
