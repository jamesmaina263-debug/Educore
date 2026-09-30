-- Part 6 of the RLS consolidation series. grading_scale_bands had 2
-- SELECT-only permissive policies; other actions already had exactly one
-- policy each and are untouched. Literal OR of the two original quals,
-- copied verbatim.
--
-- Applied directly to production via the Supabase MCP connection during the
-- audit (matches what's live, verified by reading the policy back after
-- applying and confirming RLS still on with the reduced policy count).

drop policy grading_scale_bands_select on public.grading_scale_bands;
drop policy grading_scale_bands_select_guardian_student on public.grading_scale_bands;
create policy grading_scale_bands_select on public.grading_scale_bands
  for select
  using (
    exists (
      select 1 from grading_scales gs
      where gs.id = grading_scale_bands.grading_scale_id
        and gs.school_id = auth_school_id()
        and auth_has_permission('exams.read')
    )
    or auth_can_view_grading_band_marks(id)
  );
