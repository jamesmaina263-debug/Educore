-- Part 15 of the RLS consolidation series. school_users had 2 INSERT-only
-- permissive policies. EXTRA CARE HERE: school_users is the table where a
-- real privilege-escalation bug was found and fixed in
-- 20260826072759_fix_staff_manage_cannot_grant_super_admin.sql -- the
-- school_users_insert policy's role_id-not-in-(super_admin,group_admin)
-- guard is that fix. Merging via a plain OR does not weaken it: Postgres
-- already evaluates these two permissive policies as an OR today, so this
-- changes evaluation cost, not evaluation result -- the escalation guard
-- remains its own untouched disjunct, and the guardian/student branch
-- being OR'd alongside it has no path to a super_admin/group_admin role_id
-- (it explicitly requires role_id IN ('parent','student')), so there is no
-- interaction between the two branches to get wrong.
drop policy school_users_insert on public.school_users;
drop policy school_users_insert_guardian_or_student on public.school_users;
create policy school_users_insert on public.school_users
  for insert
  with check (
    (
      auth_is_super_admin()
      or (
        school_id = auth_school_id()
        and auth_has_permission('staff.manage')
        and role_id not in (select roles.id from roles where roles.name = any (array['super_admin', 'group_admin']))
      )
    )
    or (
      school_id = auth_school_id()
      and auth_has_permission('students.write')
      and role_id in (select roles.id from roles where roles.name = any (array['parent', 'student']))
    )
  );
