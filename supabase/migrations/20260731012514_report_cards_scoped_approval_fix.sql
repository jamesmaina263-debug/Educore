
-- Bug found in live testing: the previous report_cards_update_own_class policy checked whether the
-- caller is class_teacher of ANY stream under report_cards.class_id (the grade) — but a grade can
-- have multiple streams, so a class teacher of stream A could edit a report card for a student in
-- stream B of the same grade. Fixed to check the specific student's actual stream via students.current_class_id.
drop policy report_cards_update_own_class on report_cards;

create policy report_cards_update_own_class on report_cards for update
  using (
    school_id = auth_school_id() and auth_has_permission('report_cards.approve')
    and exists (
      select 1 from students s
      join streams st on st.id = s.current_class_id
      where s.id = report_cards.student_id
        and st.class_teacher_id = (select id from school_users where auth_user_id = auth.uid())
    )
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('report_cards.approve')
    and exists (
      select 1 from students s
      join streams st on st.id = s.current_class_id
      where s.id = report_cards.student_id
        and st.class_teacher_id = (select id from school_users where auth_user_id = auth.uid())
    )
  );
