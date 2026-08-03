
-- New permission keys for the Exams module, seeded as school_id-null defaults (same pattern as
-- academics.read/write, attendance.mark/mark_any). exams.write also governs grading-scale config,
-- since grading scales are exam-time configuration, not a general "academic configuration" tab
-- (that decision was already made in Phase 1 Item 6 — Settings has no separate academics tab).
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values
  ('exams.read'), ('exams.write'), ('marks.write'), ('marks.write_any')
) as p(permission_key)
where
  (r.name in ('teacher','class_teacher','deputy_principal','principal','school_owner') and p.permission_key = 'exams.read')
  or (r.name in ('deputy_principal','principal','school_owner') and p.permission_key = 'exams.write')
  or (r.name in ('teacher','class_teacher') and p.permission_key = 'marks.write')
  or (r.name in ('deputy_principal','principal','school_owner') and p.permission_key = 'marks.write_any');

-- grading_scales: staff with exams.read can see all scales in their school; only exams.write can manage them.
create policy grading_scales_select on grading_scales for select
  using (school_id = auth_school_id() and auth_has_permission('exams.read'));

create policy grading_scales_write on grading_scales for all
  using (school_id = auth_school_id() and auth_has_permission('exams.write'))
  with check (school_id = auth_school_id() and auth_has_permission('exams.write'));

-- grading_scale_bands: scoped via parent scale's school, same permission gates.
create policy grading_scale_bands_select on grading_scale_bands for select
  using (
    exists (
      select 1 from grading_scales gs
      where gs.id = grading_scale_bands.grading_scale_id
        and gs.school_id = auth_school_id()
        and auth_has_permission('exams.read')
    )
  );

create policy grading_scale_bands_write on grading_scale_bands for all
  using (
    exists (
      select 1 from grading_scales gs
      where gs.id = grading_scale_bands.grading_scale_id
        and gs.school_id = auth_school_id()
        and auth_has_permission('exams.write')
    )
  )
  with check (
    exists (
      select 1 from grading_scales gs
      where gs.id = grading_scale_bands.grading_scale_id
        and gs.school_id = auth_school_id()
        and auth_has_permission('exams.write')
    )
  );
