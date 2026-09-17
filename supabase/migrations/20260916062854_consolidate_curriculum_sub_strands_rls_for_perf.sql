-- Part 4 of the RLS consolidation series. curriculum_sub_strands had 2
-- SELECT-only permissive policies; other actions already had exactly one
-- policy each and are untouched. Literal OR of the two original quals,
-- copied verbatim.
drop policy curriculum_sub_strands_select on public.curriculum_sub_strands;
drop policy curriculum_sub_strands_select_guardian_student on public.curriculum_sub_strands;
create policy curriculum_sub_strands_select on public.curriculum_sub_strands
  for select
  using (
    exists (
      select 1 from curriculum_strands cs
      where cs.id = curriculum_sub_strands.strand_id
        and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.read')))
    )
    or auth_can_view_sub_strand_marks(id)
  );
