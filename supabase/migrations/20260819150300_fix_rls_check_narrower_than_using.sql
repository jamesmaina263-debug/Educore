-- BUG FIX (functional, not security): two UPDATE policies had a WITH CHECK narrower than
-- their USING clause, meaning a legitimate self-service path could see/attempt an update
-- (pass USING) but the write would always be silently rejected (fail WITH CHECK) — the two
-- users this was meant to serve could never actually save.

-- 1. discipline_cases_update: an officer assigned to a case (assigned_officer = self) could
--    attempt to update it, but WITH CHECK only allowed auth_is_super_admin() or
--    discipline.cases.manage — an assigned officer without the broader manage permission
--    could never successfully update their own assigned case.
alter policy discipline_cases_update on public.discipline_cases
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('discipline.cases.manage') or assigned_officer = auth_school_user_id()))
  );

-- 2. welfare_concerns_update: the person who raised a welfare concern (raised_by = self)
--    could attempt to update it, but WITH CHECK only allowed welfare.write — someone who
--    raised a concern without separately holding welfare.write could never edit their own
--    submission.
alter policy welfare_concerns_update on public.welfare_concerns
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('welfare.write') or raised_by = auth_school_user_id()))
  );
