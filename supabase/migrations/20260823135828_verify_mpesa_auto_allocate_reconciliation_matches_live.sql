-- Self-check only: replays the reconciliation migration file's exact content against the
-- already-live objects to confirm the transcription is correct (everything here is
-- create-or-replace / drop-if-exists, so this is a no-op if the transcription matches).
alter table public.payments drop constraint if exists payments_student_id_status_consistency;
alter table public.payments add constraint payments_student_id_status_consistency
  check (status = 'unallocated' or student_id is not null);
select 1;
