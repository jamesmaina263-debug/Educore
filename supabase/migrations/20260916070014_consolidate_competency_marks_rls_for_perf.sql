-- Part 20. competency_marks had 2 ALL-cmd permissive policies (write_any +
-- write_own); merged. Select policy untouched, same residual overlap noted
-- in part 17. Applied directly to production via Supabase MCP during the
-- audit and verified live.
drop policy competency_marks_write_any on public.competency_marks;
drop policy competency_marks_write_own on public.competency_marks;
create policy competency_marks_write on public.competency_marks
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('marks.write')
      and exists (
        select 1 from students st
        join curriculum_sub_strands css on css.id = competency_marks.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where st.id = competency_marks.student_id
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
        select 1 from students st
        join curriculum_sub_strands css on css.id = competency_marks.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where st.id = competency_marks.student_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
      )
    )
  );
