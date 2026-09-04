-- Live-verified via Supabase's performance advisor against production, re-checked immediately
-- before writing this file (advisor output changes as other work lands concurrently -- this
-- reflects the state after 20260904074049_structured_rubrics.sql, the latest reconciled
-- migration). Same two issue classes the 2026-09-03 sweep
-- (add_missing_fk_covering_indexes.sql / fix_rls_auth_initplan_perf.sql) closed everywhere else,
-- catching up tables added since, including the rubric_* tables added minutes before this file
-- was written.

-- ---------------------------------------------------------------------
-- Unindexed foreign keys
-- ---------------------------------------------------------------------

create index if not exists idx_competency_indicator_ratings_band_id
  on public.competency_indicator_ratings (band_id);
create index if not exists idx_competency_indicator_ratings_school_id
  on public.competency_indicator_ratings (school_id);
create index if not exists idx_competency_indicator_ratings_teacher_id
  on public.competency_indicator_ratings (teacher_id);
create index if not exists idx_competency_indicator_ratings_term_id
  on public.competency_indicator_ratings (term_id);

create index if not exists idx_curriculum_sub_strands_content_updated_by
  on public.curriculum_sub_strands (content_updated_by);

create index if not exists idx_exams_component_id
  on public.exams (component_id);

create index if not exists idx_knec_cba_assessment_windows_created_by
  on public.knec_cba_assessment_windows (created_by);

create index if not exists idx_knec_cba_window_dismissals_dismissed_by
  on public.knec_cba_window_dismissals (dismissed_by);
create index if not exists idx_knec_cba_window_dismissals_window_id
  on public.knec_cba_window_dismissals (window_id);

create index if not exists idx_rubric_criterion_scores_band_id
  on public.rubric_criterion_scores (band_id);
create index if not exists idx_rubric_criterion_scores_criterion_id
  on public.rubric_criterion_scores (criterion_id);
create index if not exists idx_rubric_criterion_scores_entered_by
  on public.rubric_criterion_scores (entered_by);

create index if not exists idx_rubric_level_descriptors_band_id
  on public.rubric_level_descriptors (band_id);

create index if not exists idx_rubrics_created_by
  on public.rubrics (created_by);

-- ---------------------------------------------------------------------
-- auth.uid() InitPlan fix
-- ---------------------------------------------------------------------

drop policy if exists competency_indicator_ratings_select on public.competency_indicator_ratings;
create policy competency_indicator_ratings_select on public.competency_indicator_ratings
  for select using (
    (school_id = auth_school_id() and auth_has_permission('competency_ratings.read'))
    or (
      auth_user_id_is_guardian_of(student_id)
      and exists (
        select 1 from report_cards rc join exams e on e.id = rc.exam_id
        where rc.student_id = competency_indicator_ratings.student_id
          and e.term_id = competency_indicator_ratings.term_id
          and rc.comment_source = any (array['teacher_approved', 'teacher_written'])
      )
    )
    or (
      exists (
        select 1 from students st join school_users su on su.id = st.school_user_id
        where st.id = competency_indicator_ratings.student_id
          and su.auth_user_id = (select auth.uid())
      )
      and exists (
        select 1 from report_cards rc join exams e on e.id = rc.exam_id
        where rc.student_id = competency_indicator_ratings.student_id
          and e.term_id = competency_indicator_ratings.term_id
          and rc.comment_source = any (array['teacher_approved', 'teacher_written'])
      )
    )
  );

drop policy if exists rubric_criterion_scores_select on public.rubric_criterion_scores;
create policy rubric_criterion_scores_select on public.rubric_criterion_scores
  for select to authenticated
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or exists (
      select 1 from competency_marks cm
      where cm.id = rubric_criterion_scores.competency_mark_id
        and (
          (auth_user_id_is_guardian_of(cm.student_id) and exists (
            select 1 from report_cards rc where rc.exam_id = cm.exam_id
              and rc.student_id = cm.student_id
              and rc.comment_source in ('teacher_approved', 'teacher_written')
          ))
          or (exists (
            select 1 from students st join school_users su on su.id = st.school_user_id
            where st.id = cm.student_id and su.auth_user_id = (select auth.uid())
          ) and exists (
            select 1 from report_cards rc where rc.exam_id = cm.exam_id
              and rc.student_id = cm.student_id
              and rc.comment_source in ('teacher_approved', 'teacher_written')
          ))
        )
    )
  );
