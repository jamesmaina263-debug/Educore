-- check_pt_slot_capacity() counted existing bookings without locking anything, so two parents
-- booking the last seat of a slot at the same moment each saw "one seat left" (neither can see the
-- other's uncommitted row) and both inserts succeeded, overbooking the slot. Same effect when a
-- cancelled booking is re-booked at the same time as a new one.
--
-- Fix: take a row lock on the slot before counting, so concurrent bookings for the same slot run
-- one after another and the second one sees the first one's row. FOR NO KEY UPDATE is enough to
-- serialize (it conflicts with itself) and, unlike FOR UPDATE, doesn't block the FK check other
-- transactions take on the slot row. Lock order is always slot -> booking, so no deadlock cycle.
--
-- Body is otherwise identical to 20260809050124_tier3_certificates_discipline_homework_ptmeetings.
-- CREATE OR REPLACE keeps the existing ACL, so the EXECUTE revoke from
-- 20260809050452_revoke_pt_slot_capacity_trigger_execute stays in force (trigger-only function).
create or replace function check_pt_slot_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_capacity integer;
  v_booked integer;
begin
  if new.status != 'booked' then
    return new;
  end if;
  select capacity into v_capacity from pt_meeting_slots where id = new.slot_id for no key update;
  select count(*) into v_booked from pt_meeting_bookings where slot_id = new.slot_id and status = 'booked' and id != new.id;
  if v_booked >= v_capacity then
    raise exception 'This meeting slot is already fully booked.';
  end if;
  return new;
end;
$$;
