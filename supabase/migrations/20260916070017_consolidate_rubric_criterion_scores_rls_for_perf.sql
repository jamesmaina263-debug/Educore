-- Part 23 (last of this batch). rubric_criterion_scores had 2 ALL-cmd
-- permissive policies (write_any + write_own); merged. Select policy
-- untouched, same residual overlap noted in part 17. Applied directly to
-- production via Supabase MCP during the audit and verified live.
drop policy rubric_criterion_scores_write_any on public.rubric_criterion_scores;
drop policy rubric_criterion_scores_write_own on public.rubric_criterion_scores;
create policy rubric_criterion_scores_write on public.rubric_criterion_scores
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('marks.write')
      and exists (
        select 1 from competency_marks cm
        join students st on st.id = cm.student_id
        join curriculum_sub_strands css on css.id = cm.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where cm.id = rubric_criterion_scores.competency_mark_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
      )
    )
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('marks.write')
      and exists (
        select 1 from competency_marks cm
        join students st on st.id = cm.student_id
        join curriculum_sub_strands css on css.id = cm.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where cm.id = rubric_criterion_scores.competency_mark_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
      )
    )
  );
