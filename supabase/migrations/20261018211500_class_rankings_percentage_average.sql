-- class_rankings.average_score is now the mean of each subject's score as a PERCENTAGE of that
-- subject's maximum (exam_subjects.max_score), instead of the mean of raw scores.
--
-- Why: exam_subjects.max_score is configurable per subject and class (default 100). A raw-score
-- mean treats 40/50 and 40/100 as the same 40, so a learner who sat an out-of-50 practical was
-- ranked against learners on a different scale. With percentages every subject counts equally
-- regardless of its maximum. Every existing reader already treats average_score as a percentage
-- (the at-risk rule is "average < 40", the portal/report cards print it as the average), so this
-- makes the stored value match how it is used.
--
-- Impact: for a class whose subjects are all out of 100 the result is IDENTICAL to before
-- (raw * 100 / 100 = raw, computed exactly in numeric). Ordering/ties are unchanged: positions
-- still come from rank() over the unrounded mean, so equal means share a position (1,2,2,4).
--
-- Deliberately unchanged: total_score stays the SUM OF RAW SCORES (a total of marks obtained);
-- only learners' entered numeric marks count (a missing mark is never treated as zero, a genuine
-- 0 counts as 0%); CBC band-only marks (no raw_score) are still excluded; subjects_counted,
-- stream/class rank semantics, security definer, grants and every caller (close_exam and the
-- post-close correction trigger) are untouched.
--
-- Safety: marks.raw_score is validated <= max_score (resolve_mark_band) so a percentage is at
-- most 100 and fits numeric(5,2). A subject with max_score <= 0 cannot hold a positive score and
-- would divide by zero, so it is excluded from ranking rather than allowed to break closing an
-- exam. No data is modified by this migration: stored rows are replaced only the next time an
-- exam is closed or a closed exam's mark is corrected, exactly as today.

create or replace function public.recompute_class_rankings(p_exam_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.class_rankings where exam_id = p_exam_id;

  insert into public.class_rankings (exam_id, class_id, stream_id, student_id, total_score, average_score, subjects_counted, rank_in_stream, rank_in_class)
  select
    p_exam_id,
    m.class_id,
    st.current_class_id,
    m.student_id,
    sum(m.raw_score),
    avg(m.raw_score * 100.0 / es.max_score),
    count(m.raw_score),
    rank() over (partition by st.current_class_id order by avg(m.raw_score * 100.0 / es.max_score) desc),
    rank() over (partition by m.class_id order by avg(m.raw_score * 100.0 / es.max_score) desc)
  from public.marks m
  join public.exam_subjects es
    on es.exam_id = m.exam_id and es.class_id = m.class_id and es.subject_id = m.subject_id
  join public.students st on st.id = m.student_id
  join public.classes c on c.id = m.class_id
  join public.schools s on s.id = c.school_id
  where m.exam_id = p_exam_id
    and m.raw_score is not null -- numeric-scale marks only; CBC marks have no raw_score to average
    and es.max_score > 0
  group by m.class_id, st.current_class_id, m.student_id;
end;
$$;

revoke all on function public.recompute_class_rankings(uuid) from public, anon, authenticated;

comment on column public.class_rankings.average_score is
  'Mean of the learner''s entered numeric scores, each expressed as a percentage of that subject''s max_score (0-100). total_score remains the sum of raw scores.';
