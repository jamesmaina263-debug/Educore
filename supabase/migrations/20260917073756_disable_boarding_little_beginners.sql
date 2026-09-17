-- Little Beginners School (owner request, Sept 2026): remove the Boarding module for this
-- school only. Confirmed before this migration: 0 boarding_houses, 0 hostel_allocations, 0
-- boarding_incidents, 0 boarding_transfers for this school -- nothing to migrate or clean up,
-- this is purely a visibility/access toggle for one tenant. No other school's row is touched.
update public.schools
set boarding_enabled = false
where id = 'bc0e14ef-25ed-492d-8999-8d9718c3c2d1' -- Little Beginners School
  and name = 'Little Beginners School';
