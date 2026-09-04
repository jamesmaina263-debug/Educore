-- PR-08 evidence-gathering (2026-09-04) found the same RLS-gap pattern PR-03 found
-- on subjects/classes/streams, now on exams, curriculum_strands,
-- curriculum_sub_strands and grading_scale_bands: staff-only SELECT, zero
-- guardian/student branch. Confirmed live: the guardian portal's report-card query
-- (embeds exams(name)) and its CBC competency breakdown (embeds
-- grading_scale_bands(label), curriculum_sub_strands(name, curriculum_strands(name)))
-- both silently returned nothing for a guardian, even with a real released report
-- card and competency marks present.
--
-- Unlike PR-03's fix (subjects/classes/streams are generic day-to-day reference
-- data, scoped to "any member of the school"), these four tables sit in the
-- exam/report-card family, which the codebase already treats more strictly
-- elsewhere: competency_marks and class_rankings both correctly scope guardian
-- access to "only once a report card has actually been released
-- (comment_source in teacher_approved/teacher_written)". This migration adds new
-- permissive SELECT policies (existing staff policies are untouched) matching
-- that same already-established, tighter convention, via the existing
-- auth_user_id_is_guardian_of() helper -- rather than loosening these to the
-- looser school-membership scope PR-03 used, which would let a guardian browse
-- exam/curriculum data with no released report card behind it at all.

create policy exams_select_guardian_student on exams for select
using (
  exists (
    select 1 from report_cards rc
    where rc.exam_id = exams.id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(rc.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = rc.student_id and su.auth_user_id = (select auth.uid())
        )
      )
  )
);

create policy curriculum_sub_strands_select_guardian_student on curriculum_sub_strands for select
using (
  exists (
    select 1 from competency_marks cm
    join report_cards rc on rc.exam_id = cm.exam_id and rc.student_id = cm.student_id
    where cm.sub_strand_id = curriculum_sub_strands.id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(cm.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = cm.student_id and su.auth_user_id = (select auth.uid())
        )
      )
  )
);

create policy curriculum_strands_select_guardian_student on curriculum_strands for select
using (
  exists (
    select 1 from curriculum_sub_strands css
    join competency_marks cm on cm.sub_strand_id = css.id
    join report_cards rc on rc.exam_id = cm.exam_id and rc.student_id = cm.student_id
    where css.strand_id = curriculum_strands.id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(cm.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = cm.student_id and su.auth_user_id = (select auth.uid())
        )
      )
  )
);

create policy grading_scale_bands_select_guardian_student on grading_scale_bands for select
using (
  exists (
    select 1 from competency_marks cm
    join report_cards rc on rc.exam_id = cm.exam_id and rc.student_id = cm.student_id
    where cm.band_id = grading_scale_bands.id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(cm.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = cm.student_id and su.auth_user_id = (select auth.uid())
        )
      )
  )
);
