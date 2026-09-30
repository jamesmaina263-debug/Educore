-- purge_expired_communications() (see 20260824153119_communication_retention_archive_purge.sql)
-- hard-deletes notification_logs rows past purge_at in a single bulk DELETE. But
-- biometric_events.notification_log_id (added in 20260823181104_biometric_module_v2_supersede_phase1.sql)
-- references notification_logs(id) with no ON DELETE action, so the default RESTRICT/NO ACTION
-- applies -- any purge batch containing a row still referenced by a biometric_events row fails
-- the WHOLE bulk delete, not just that one row.
--
-- Confirmed live in production: as of 2026-09-23, 35 notification_logs rows were eligible for
-- purge, blocked by a single referencing biometric_events row, with the oldest stuck since
-- 2026-09-08 -- the daily communication-retention cron's purge step had been silently failing
-- for ~2 weeks (see "Communication-retention cron (purge step) failed" alerts).
--
-- A biometric event losing its notification_log_id on purge is fine -- the event record itself
-- (device, student, timestamp, verification) is untouched; only the link to a message that's
-- about to stop existing anyway goes null, same as notification_status already independently
-- tracks whether that notification was sent.
alter table public.biometric_events
  drop constraint biometric_events_notification_log_id_fkey;

alter table public.biometric_events
  add constraint biometric_events_notification_log_id_fkey
  foreign key (notification_log_id) references public.notification_logs(id)
  on delete set null;
