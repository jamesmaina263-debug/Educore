-- Phase 25 (audit item #4, part 1): allow a former student to be reactivated.
--
-- Confirmed live before this fix: enforce_student_status_transition() had no
-- edge out of withdrawn/transferred/graduated at all. A returning student, a
-- transfer coming back, or a re-admission -- all explicitly listed as cases
-- to support -- would hit "invalid student status transition: withdrawn ->
-- active" the moment complete_enrollment() tried to reactivate them after an
-- officer used the existing checkForDuplicateStudents/createOrLinkStudent
-- flow to link a re-admission application to their old record. Verified
-- directly against the live DB: a real withdraw-then-reactivate attempt
-- raised exactly this exception before this migration.
--
-- enforce_student_has_primary_guardian() already blocks any transition INTO
-- active/enrolled unless a primary-contact guardian is on file, so this
-- doesn't weaken that invariant -- it only removes a transition that was
-- permanently blocked with no legitimate way around it.

create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'applied'     and new.status in ('approved','withdrawn')) or
      (old.status = 'approved'    and new.status in ('enrolled','withdrawn')) or
      (old.status = 'enrolled'    and new.status in ('active','withdrawn','transferred')) or
      (old.status = 'active'      and new.status in ('withdrawn','transferred','graduated')) or
      -- Returning / re-admitted / transferred-back students re-entering
      -- through the normal Admissions pipeline (createOrLinkStudent ->
      -- complete_enrollment), which links to the *existing* student row
      -- rather than creating a new one, per Brief 4.16's "avoid duplicate
      -- student records" requirement.
      (old.status in ('withdrawn','transferred','graduated') and new.status = 'active')
    ) then
      raise exception 'invalid student status transition: % -> %', old.status, new.status;
    end if;

    new.status_changed_at := now();

    if new.status in ('withdrawn','transferred','graduated') then
      new.current_class_id := null;
    end if;
  end if;
  return new;
end;
$$;
