-- Part 18. competency_indicator_ratings had 2 ALL-cmd permissive policies
-- (write_any + write_own); merged. Select policy untouched, same reasoning
-- as competency_evidence above.
drop policy competency_indicator_ratings_write_any on public.competency_indicator_ratings;
drop policy competency_indicator_ratings_write_own on public.competency_indicator_ratings;
create policy competency_indicator_ratings_write on public.competency_indicator_ratings
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('competency_ratings.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('competency_ratings.write')
      and exists (
        select 1 from students st
        where st.id = competency_indicator_ratings.student_id
          and auth_user_is_class_teacher_of_stream(st.current_class_id)
      )
    )
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('competency_ratings.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('competency_ratings.write')
      and exists (
        select 1 from students st
        where st.id = competency_indicator_ratings.student_id
          and auth_user_is_class_teacher_of_stream(st.current_class_id)
      )
    )
  );
