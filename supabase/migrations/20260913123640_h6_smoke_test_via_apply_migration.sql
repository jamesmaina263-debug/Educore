-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260913123640 -- reconstructed, not rewritten.

create or replace function public._h6_smoke_via_migration() returns text language sql as $$ select 'ok' $$;
