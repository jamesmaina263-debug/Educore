-- Three separate code paths write student_guardians.primary_contact (direct
-- student registration, the guardians tab, the admissions wizard), but only
-- the guardians-tab path (linkGuardian) demoted any existing primary contact
-- first. The other two just insert/update primary_contact=true directly,
-- with nothing stopping a student ending up with two simultaneous primary
-- contacts -- confirmed live on one student: a leftover seed/test guardian
-- link with no phone number and a real guardian both flagged
-- primary_contact=true.
--
-- Real consequence, not just theoretical: check_fee_thresholds() joins on
-- primary_contact=true with a plain loop, not a single-row assumption -- a
-- student with two primary contacts would get two separate
-- fee_threshold_alerts drafted (and potentially double-sent) once their
-- balance crosses the school's threshold.
--
-- Fix at the DB level so it's closed regardless of which code path (or a
-- future one) writes the row: a trigger that demotes any other primary
-- contact for the same student whenever a row is set primary_contact=true,
-- plus a unique partial index as a hard guarantee.

create or replace function public.enforce_single_primary_guardian()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.primary_contact = true then
    update public.student_guardians
    set primary_contact = false
    where student_id = new.student_id
      and primary_contact = true
      and id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_student_guardians_single_primary on public.student_guardians;
create trigger trg_student_guardians_single_primary
before insert or update of primary_contact on public.student_guardians
for each row
when (new.primary_contact = true)
execute function public.enforce_single_primary_guardian();

create unique index if not exists idx_student_guardians_one_primary
  on public.student_guardians (student_id)
  where primary_contact = true;
