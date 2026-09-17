-- Part 19. competency_indicators had 2 ALL-cmd permissive policies
-- (school_write for school-authored rows + super_admin_write for global
-- rows); merged. Select policy untouched, same reasoning as above.
drop policy competency_indicators_school_write on public.competency_indicators;
drop policy competency_indicators_super_admin_write on public.competency_indicators;
create policy competency_indicators_write on public.competency_indicators
  for all
  using (
    (type = 'school_authored' and school_id = auth_school_id() and auth_has_permission('academics.write'))
    or (school_id is null and auth_is_super_admin())
  )
  with check (
    (type = 'school_authored' and school_id = auth_school_id() and auth_has_permission('academics.write'))
    or (school_id is null and auth_is_super_admin())
  );
