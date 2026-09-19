-- Part 3 of the RLS consolidation series (after marks, assignment_submissions).
-- curriculum_strands had 2 SELECT-only permissive policies; other actions
-- already had exactly one policy each and are untouched. Literal OR of the
-- two original quals, copied verbatim.
drop policy curriculum_strands_select on public.curriculum_strands;
drop policy curriculum_strands_select_guardian_student on public.curriculum_strands;
create policy curriculum_strands_select on public.curriculum_strands
  for select
  using (
    (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')))
    or auth_can_view_curriculum_strand(id)
  );
