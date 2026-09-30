-- The sick-bay check-out form (src/components/health/sick-bay-section.tsx) and checkOutStudent()
-- both offer "Collected by guardian" as an outcome -- one of the most common ways a sick-bay visit
-- actually ends -- but sick_bay_visits_outcome_check (20260809132222_health_module_phase7) only
-- allows returned_to_class / sent_home / referred / admitted_emergency. Selecting it always failed
-- with a raw check-constraint violation, so the visit could never be closed that way.
--
-- Purely additive: every value the constraint accepted before is still accepted, so no existing
-- row can be affected. admitted_emergency is kept as-is even though the form doesn't offer it.
alter table public.sick_bay_visits drop constraint if exists sick_bay_visits_outcome_check;
alter table public.sick_bay_visits
  add constraint sick_bay_visits_outcome_check
  check (outcome = any (array['returned_to_class','sent_home','referred','admitted_emergency','collected_by_guardian']));
