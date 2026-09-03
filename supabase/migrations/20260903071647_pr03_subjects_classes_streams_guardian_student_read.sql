-- PR-03 evidence-gathering (2026-09-03) found a real production RLS gap: subjects,
-- classes and streams had no guardian- or student-facing SELECT branch at all --
-- only staff (school_id = auth_school_id() + academics.read permission) or super admin
-- could read them. Any guardian/student-facing query embedding subjects(name),
-- classes(name) or streams(name) via PostgREST therefore silently returned null for
-- that field (confirmed live: guardian portal showed real timetable rows with every
-- subject name blank). Adds a read branch mirroring the existing pattern already used
-- on timetable_slots_select: a guardian of any enrolled student at the school, or the
-- student's own account, may read these three reference tables. They contain only
-- curriculum-reference data (subject/class/stream names), not sensitive information,
-- so scoping to "any member of the school via a real student link" is appropriate --
-- consistent with how timetable_slots already treats the same relationship.

drop policy subjects_select on subjects;
create policy subjects_select on subjects for select
using (
  auth_is_super_admin()
  or (school_id = auth_school_id() and auth_has_permission('academics.read'))
  or exists (
    select 1 from students st join school_users su on su.id = st.school_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = subjects.school_id
  )
  or exists (
    select 1 from students st
    join student_guardians sg on sg.student_id = st.id
    join school_users su on su.id = sg.guardian_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = subjects.school_id
  )
);

drop policy classes_select on classes;
create policy classes_select on classes for select
using (
  auth_is_super_admin()
  or (school_id = auth_school_id() and auth_has_permission('academics.read'))
  or exists (
    select 1 from students st join school_users su on su.id = st.school_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = classes.school_id
  )
  or exists (
    select 1 from students st
    join student_guardians sg on sg.student_id = st.id
    join school_users su on su.id = sg.guardian_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = classes.school_id
  )
);

drop policy streams_select on streams;
create policy streams_select on streams for select
using (
  auth_is_super_admin()
  or (school_id = auth_school_id() and auth_has_permission('academics.read'))
  or exists (
    select 1 from students st join school_users su on su.id = st.school_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = streams.school_id
  )
  or exists (
    select 1 from students st
    join student_guardians sg on sg.student_id = st.id
    join school_users su on su.id = sg.guardian_user_id
    where su.auth_user_id = (select auth.uid()) and st.school_id = streams.school_id
  )
);
