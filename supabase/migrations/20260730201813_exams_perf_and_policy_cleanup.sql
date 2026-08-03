
-- Covering indexes for FKs flagged by the performance advisor.
create index exams_school_id_idx on exams (school_id);
create index exams_term_id_idx on exams (term_id);
create index exams_closed_by_idx on exams (closed_by);
create index exam_classes_class_id_idx on exam_classes (class_id);
create index exam_subjects_class_id_idx on exam_subjects (class_id);
create index exam_subjects_subject_id_idx on exam_subjects (subject_id);
create index marks_school_id_idx on marks (school_id);
create index marks_class_id_idx on marks (class_id);
create index marks_subject_id_idx on marks (subject_id);
create index marks_student_id_idx on marks (student_id);
create index marks_band_id_idx on marks (band_id);
create index marks_entered_by_idx on marks (entered_by);
create index marks_exam_class_subject_idx on marks (exam_id, class_id, subject_id);
create index class_rankings_class_id_idx on class_rankings (class_id);
create index class_rankings_stream_id_idx on class_rankings (stream_id);
create index class_rankings_student_id_idx on class_rankings (student_id);

-- Multiple permissive SELECT policies: each table had a dedicated _select policy plus a `for all`
-- write policy, and `for all` covers SELECT too, so Postgres was evaluating two permissive policies
-- per read. Everyone who can write here already has the matching read permission (seeded together),
-- so narrowing the write policies to insert/update/delete removes the overlap without losing access.
drop policy grading_scales_write on grading_scales;
create policy grading_scales_write on grading_scales for insert with check (school_id = auth_school_id() and auth_has_permission('exams.write'));
create policy grading_scales_update on grading_scales for update using (school_id = auth_school_id() and auth_has_permission('exams.write')) with check (school_id = auth_school_id() and auth_has_permission('exams.write'));
create policy grading_scales_delete on grading_scales for delete using (school_id = auth_school_id() and auth_has_permission('exams.write'));

drop policy grading_scale_bands_write on grading_scale_bands;
create policy grading_scale_bands_write on grading_scale_bands for insert with check (exists (select 1 from grading_scales gs where gs.id = grading_scale_bands.grading_scale_id and gs.school_id = auth_school_id() and auth_has_permission('exams.write')));
create policy grading_scale_bands_update on grading_scale_bands for update
  using (exists (select 1 from grading_scales gs where gs.id = grading_scale_bands.grading_scale_id and gs.school_id = auth_school_id() and auth_has_permission('exams.write')))
  with check (exists (select 1 from grading_scales gs where gs.id = grading_scale_bands.grading_scale_id and gs.school_id = auth_school_id() and auth_has_permission('exams.write')));
create policy grading_scale_bands_delete on grading_scale_bands for delete
  using (exists (select 1 from grading_scales gs where gs.id = grading_scale_bands.grading_scale_id and gs.school_id = auth_school_id() and auth_has_permission('exams.write')));

drop policy exams_write on exams;
create policy exams_write on exams for insert with check (school_id = auth_school_id() and auth_has_permission('exams.write'));
create policy exams_update on exams for update using (school_id = auth_school_id() and auth_has_permission('exams.write')) with check (school_id = auth_school_id() and auth_has_permission('exams.write'));
create policy exams_delete on exams for delete using (school_id = auth_school_id() and auth_has_permission('exams.write'));

drop policy exam_classes_write on exam_classes;
create policy exam_classes_write on exam_classes for insert with check (exists (select 1 from exams e where e.id = exam_classes.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));
create policy exam_classes_delete on exam_classes for delete using (exists (select 1 from exams e where e.id = exam_classes.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));

drop policy exam_subjects_write on exam_subjects;
create policy exam_subjects_write on exam_subjects for insert with check (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));
create policy exam_subjects_update on exam_subjects for update
  using (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')))
  with check (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));
create policy exam_subjects_delete on exam_subjects for delete using (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));

-- marks: marks_write_own / marks_write_any were both `for all`, overlapping with marks_select AND
-- each other on every action. Split each into insert/update/delete; both scoped roles already carry
-- exams.read (covered by marks_select), and a teacher with only marks.write should never need
-- marks.write_any's broader visibility, so no read capability is lost.
drop policy marks_write_own on marks;
create policy marks_write_own_insert on marks for insert with check (
  school_id = auth_school_id() and auth_has_permission('marks.write')
  and exists (select 1 from students st where st.id = marks.student_id and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id))
);
create policy marks_write_own_update on marks for update
  using (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (select 1 from students st where st.id = marks.student_id and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id))
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (select 1 from students st where st.id = marks.student_id and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id))
  );
create policy marks_write_own_delete on marks for delete using (
  school_id = auth_school_id() and auth_has_permission('marks.write')
  and exists (select 1 from students st where st.id = marks.student_id and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id))
);

drop policy marks_write_any on marks;
create policy marks_write_any_insert on marks for insert with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));
create policy marks_write_any_update on marks for update using (school_id = auth_school_id() and auth_has_permission('marks.write_any')) with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));
create policy marks_write_any_delete on marks for delete using (school_id = auth_school_id() and auth_has_permission('marks.write_any'));
