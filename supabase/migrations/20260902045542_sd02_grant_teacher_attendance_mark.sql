-- SD-02 (GTM Readiness Protocol) verification found a real gap: the 'teacher'
-- role had no default grant of 'attendance.mark' anywhere -- neither globally
-- nor for any individual school. The RLS policy on student_attendance
-- (student_attendance_write) is correctly designed around a class-teacher-scoped
-- 'attendance.mark' permission, and the permission key exists in the catalog,
-- but the default grant that should accompany it was never added. Net effect:
-- no teacher, in any school on the platform, could mark attendance for their
-- own class by default. Teachers already correctly have 'marks.write' (grades)
-- and 'attendance.read' -- this was an isolated omission, not a systemic
-- missing-permissions issue for the role.

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'attendance.mark', true
from public.roles r
where r.name = 'teacher'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'attendance.mark'
  );
