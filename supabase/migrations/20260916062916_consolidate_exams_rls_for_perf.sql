-- Part 5 of the RLS consolidation series. exams had 2 SELECT-only permissive
-- policies; other actions already had exactly one policy each and are
-- untouched. Literal OR of the two original quals, copied verbatim.
--
-- Applied directly to production via the Supabase MCP connection during the
-- audit (matches what's live, verified by reading the policy back after
-- applying and confirming RLS still on with the reduced policy count).

drop policy exams_select on public.exams;
drop policy exams_select_guardian_student on public.exams;
create policy exams_select on public.exams
  for select
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or exists (
      select 1 from report_cards rc
      where rc.exam_id = exams.id
        and auth_can_view_released_report_card(rc.exam_id, rc.student_id)
    )
  );
