-- Lets a student, a guardian, or staff read ONE student's multi-year results with the reference data
-- (academic year, term, paper maximum, grading band) needed to build a progress-since-enrolment view.
--
-- Why a function: marks_select already lets a guardian or the student read their own released marks,
-- but the live RLS gives those people no SELECT on academic_years, terms, exam_subjects or grading
-- scales, so a join from marks to the year/term it belongs to returns nothing for them and their
-- history cannot be built. Opening those tables to every guardian is a wider change than needed.
--
-- Security model: SECURITY DEFINER, but each returned mark must pass EXACTLY the marks_select
-- predicate, evaluated against the caller:
--   1. staff:    marks.school_id = auth_school_id() AND auth_has_permission('exams.read');
--   2. guardian / the student themselves: auth_can_view_released_report_card(exam, student), the existing
--      helper that checks a released report card (teacher_approved / teacher_written) for a guardian of,
--      or the user behind, that student.
-- Only closed exams are returned. Nothing is returned that the caller could not already read from
-- `marks`; the function only adds the year/term/maximum/band names for those same marks. Callers
-- who match neither branch get zero rows, never an error that reveals the student exists.

create or replace function public.get_student_performance_marks(p_student_id uuid)
returns table (
  student_id uuid, class_id uuid, class_name text, subject_id uuid, subject_name text,
  exam_id uuid, exam_name text, raw_score numeric, max_score numeric,
  band_label text, band_points numeric, band_level_order integer, band_scale_id uuid, level_count integer,
  term_number integer, year_id uuid, year_name text, year_start date
)
language sql
stable
security definer
set search_path = public
as $$
  select m.student_id, m.class_id, c.name, m.subject_id, s.name,
         m.exam_id, e.name, m.raw_score, es.max_score,
         b.label, b.points, b.level_order::integer, b.grading_scale_id,
         (select max(x.level_order)::integer from public.grading_scale_bands x where x.grading_scale_id = b.grading_scale_id),
         t.term_number::integer, ay.id, ay.name, ay.start_date
  from public.marks m
  join public.exams e on e.id = m.exam_id and e.status = 'closed'
  join public.terms t on t.id = e.term_id
  join public.academic_years ay on ay.id = t.academic_year_id
  join public.classes c on c.id = m.class_id
  join public.subjects s on s.id = m.subject_id
  left join public.exam_subjects es on es.exam_id = m.exam_id and es.class_id = m.class_id and es.subject_id = m.subject_id
  left join public.grading_scale_bands b on b.id = m.band_id
  where m.student_id = p_student_id
    and (m.raw_score is not null or m.band_id is not null)
    and (
      (m.school_id = public.auth_school_id() and public.auth_has_permission('exams.read'))
      or public.auth_can_view_released_report_card(m.exam_id, m.student_id)
    )
  order by ay.start_date, t.term_number, e.created_at, s.name;
$$;

revoke all on function public.get_student_performance_marks(uuid) from public, anon;
grant execute on function public.get_student_performance_marks(uuid) to authenticated;
