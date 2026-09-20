-- The parent portal shows each PT-meeting slot with "Book" or "Full", but it derived the booked
-- count from an embedded pt_meeting_bookings(...) select run under the parent's own RLS -- and
-- guardians can only see their OWN bookings (pt_meeting_bookings_select_guardian). So the count was
-- always 0 or 1, no slot ever showed as Full, and a parent only learned a slot was taken from the
-- capacity trigger's error after clicking Book.
--
-- This returns just the per-slot booked count (no names, no student ids) for slots in the caller's
-- own school, so the portal can show real availability without loosening bookings' RLS.
--
-- SECURITY DEFINER functions in the public schema get PUBLIC/anon EXECUTE by default, so it is
-- revoked explicitly and granted to authenticated only; the school scope is enforced inside.
create or replace function public.pt_slot_booked_counts(p_slot_ids uuid[])
returns table (slot_id uuid, booked_count integer)
language sql stable security definer set search_path = public as $$
  select s.id, (count(b.id) filter (where b.status = 'booked'))::integer
  from pt_meeting_slots s
  left join pt_meeting_bookings b on b.slot_id = s.id
  where s.id = any(p_slot_ids)
    and s.school_id = auth_school_id()
  group by s.id;
$$;

revoke all on function public.pt_slot_booked_counts(uuid[]) from public, anon;
grant execute on function public.pt_slot_booked_counts(uuid[]) to authenticated;
