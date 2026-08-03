-- Creating a guardian's (or a student's own) school_users row is
-- functionally part of the Students module, not staff management --
-- someone with students.write shouldn't need staff.manage just to
-- register a new parent contact. RLS combines multiple policies for
-- the same command with OR, so this only ever adds permission, never
-- removes what school_users_insert already allows.
create policy school_users_insert_guardian_or_student on school_users
  for insert
  with check (
    school_id = auth_school_id()
    and auth_has_permission('students.write')
    and role_id in (select id from roles where name in ('parent', 'student'))
  );
