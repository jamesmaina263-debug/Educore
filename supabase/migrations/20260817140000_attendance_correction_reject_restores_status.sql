-- editAttendanceRecord() applies a correction to `status` immediately (by
-- design -- a class teacher shouldn't be blocked from fixing a same-day
-- mistake), flagging it for after-the-fact review. But nothing ever stored
-- what `status` was *before* the correction, so reviewAttendanceCorrection()
-- rejecting a correction could only set a correction_status='rejected' label
-- -- the disputed value stayed live in `status` forever. "Reject" was
-- indistinguishable from "Approve" except for an invisible flag nobody's UI
-- surfaces after the fact.

alter table public.student_attendance add column if not exists previous_status text;

comment on column public.student_attendance.previous_status is
  'The status value immediately before a pending correction was applied. Set by editAttendanceRecord, consumed (and cleared) by reviewAttendanceCorrection on reject to actually restore it. Null when no correction is pending or after review.';
