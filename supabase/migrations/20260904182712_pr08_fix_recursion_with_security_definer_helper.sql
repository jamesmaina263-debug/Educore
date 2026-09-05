-- Fixes "infinite recursion detected in policy for relation competency_marks"
-- from the previous migration: exams_select_guardian_student,
-- curriculum_sub_strands_select_guardian_student,
-- curriculum_strands_select_guardian_student and
-- grading_scale_bands_select_guardian_student all embedded a raw (non-security-
-- definer) EXISTS subquery against competency_marks/report_cards/students/
-- school_users directly in their USING clause. Per the standing lesson on this
-- exact bug class (see the PA/announcements RLS-recursion fix): when several
-- sibling tables' policies all subquery the same third table and a single
-- query joins those siblings together, the planner can end up needing to
-- re-evaluate that third table's own RLS recursively. The fix is the same one
-- already used there -- move the shared check into a SECURITY DEFINER helper
-- function, which runs outside RLS and can't recurse back into it.

drop policy exams_select_guardian_student on exams;
drop policy curriculum_sub_strands_select_guardian_student on curriculum_sub_strands;
drop policy curriculum_strands_select_guardian_student on curriculum_strands;
drop policy grading_scale_bands_select_guardian_student on grading_scale_bands;

create or replace function auth_can_view_released_report_card(p_exam_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from report_cards rc
    where rc.exam_id = p_exam_id
      and rc.student_id = p_student_id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(rc.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = rc.student_id and su.auth_user_id = auth.uid()
        )
      )
  );
$$;

revoke execute on function auth_can_view_released_report_card(uuid, uuid) from public;
grant execute on function auth_can_view_released_report_card(uuid, uuid) to authenticated;

create policy exams_select_guardian_student on exams for select
using (
  exists (
    select 1 from report_cards rc
    where rc.exam_id = exams.id
      and auth_can_view_released_report_card(rc.exam_id, rc.student_id)
  )
);

create policy curriculum_sub_strands_select_guardian_student on curriculum_sub_strands for select
using (
  exists (
    select 1 from competency_marks cm
    where cm.sub_strand_id = curriculum_sub_strands.id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  )
);

create policy curriculum_strands_select_guardian_student on curriculum_strands for select
using (
  exists (
    select 1 from curriculum_sub_strands css
    join competency_marks cm on cm.sub_strand_id = css.id
    where css.strand_id = curriculum_strands.id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  )
);

create policy grading_scale_bands_select_guardian_student on grading_scale_bands for select
using (
  exists (
    select 1 from competency_marks cm
    where cm.band_id = grading_scale_bands.id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  )
);
