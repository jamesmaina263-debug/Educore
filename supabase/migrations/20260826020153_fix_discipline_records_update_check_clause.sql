-- discipline_records_update's WITH CHECK clause was weaker than its USING clause:
-- USING requires (discipline.read_any OR recorded_by = self) AND discipline.write to
-- target a row, but CHECK only required school_id + discipline.write on the new row --
-- dropping the ownership constraint entirely. A staff member with discipline.write but
-- not discipline.read_any could target their own recorded row (passes USING) and then
-- rewrite recorded_by to a different staff member's id, or move the record onto a
-- different student_id/case_id within the school -- an audit-trail integrity gap.
-- Align CHECK with USING's ownership requirement.

drop policy if exists discipline_records_update on public.discipline_records;

create policy discipline_records_update on public.discipline_records
  for update
  using (
    (school_id = auth_school_id())
    and (
      auth_has_permission('discipline.read_any')
      or (recorded_by = (select su.id from school_users su where su.auth_user_id = auth.uid()))
    )
    and auth_has_permission('discipline.write')
  )
  with check (
    (school_id = auth_school_id())
    and (
      auth_has_permission('discipline.read_any')
      or (recorded_by = (select su.id from school_users su where su.auth_user_id = auth.uid()))
    )
    and auth_has_permission('discipline.write')
  );
