-- Part 14 of the RLS consolidation series. report_cards had 2 UPDATE-only
-- permissive policies, each already with an explicit with_check identical
-- to its own qual, so the combined with_check below is the same expression
-- as the combined using.
drop policy report_cards_update_any on public.report_cards;
drop policy report_cards_update_own_class on public.report_cards;
create policy report_cards_update on public.report_cards
  for update
  using (
    (school_id = auth_school_id() and auth_has_permission('report_cards.approve_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('report_cards.approve')
      and exists (
        select 1 from students s
        join streams st on st.id = s.current_class_id
        where s.id = report_cards.student_id
          and st.class_teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
      )
    )
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('report_cards.approve_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('report_cards.approve')
      and exists (
        select 1 from students s
        join streams st on st.id = s.current_class_id
        where s.id = report_cards.student_id
          and st.class_teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
      )
    )
  );
