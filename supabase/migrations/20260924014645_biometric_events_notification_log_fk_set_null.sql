-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260924014645 -- reconstructed, not rewritten.

-- purge_expired_communications() hard-deletes notification_logs rows past purge_at, but
-- biometric_events.notification_log_id referenced notification_logs(id) with no ON DELETE
-- action, so any purge batch containing a referenced row failed the whole bulk delete with
-- "violates foreign key constraint biometric_events_notification_log_id_fkey" -- confirmed live
-- (35 rows stuck since 2026-09-08, blocked by 1 referencing biometric_events row). A biometric
-- event losing its notification link on purge is fine -- the event record itself is untouched,
-- only the link to a message that's about to stop existing anyway.
alter table public.biometric_events
  drop constraint biometric_events_notification_log_id_fkey;

alter table public.biometric_events
  add constraint biometric_events_notification_log_id_fkey
  foreign key (notification_log_id) references public.notification_logs(id)
  on delete set null;
