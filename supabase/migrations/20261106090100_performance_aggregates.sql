-- Database-side aggregation for School Analytics, so a large school's page no longer has to transfer
-- every individual mark (the app used to read up to 100,000 rows and then warn it was cut short).
--
-- Three functions, none of which can reach anything the caller could not already read:
--   analytics_mark_score()               the single scoring rule, IMMUTABLE and pure. It mirrors
--                                        normaliseMarks() in src/lib/academics/performance-analytics.ts
--                                        exactly (the SQL test pins every edge case).
--   performance_group_aggregates()       one row per class x subject x year x term x model, with the
--                                        number of marks and the SUM of their scores.
--   performance_student_aggregates()     one row per student x class x year x term x model (optionally
--                                        for one subject), same two measures.
-- Both aggregates are SECURITY INVOKER: they run as the caller, so marks / exams / terms RLS applies
-- unchanged and a user sees only what they could already read. No privilege is added.
--
-- Scoring (kept identical to the TypeScript):
--   * a mark with a raw_score is a PERCENT mark: raw / paper maximum * 100 (maximum > 0, raw >= 0);
--   * otherwise a mark with a band is a CBC LEVEL mark: the band's own points when it has them, else
--     best level = number of levels ... worst = 1;  unscorable marks (missing values, order outside
--     1..levels) are dropped, never counted as zero.
-- Numeric-model marks also carry a derived band_id (resolve_mark_band), so the raw score MUST be
-- checked first: a mark is only a level mark when it has no raw score.

create or replace function public.analytics_mark_score(
  p_raw numeric,
  p_max numeric,
  p_level_order integer,
  p_level_count integer,
  p_points numeric,
  p_has_band boolean
) returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_raw is not null then
      case when p_max is not null and p_max > 0 and p_raw >= 0 then p_raw / p_max * 100 end
    when p_has_band then
      case when p_level_order is not null and p_level_count is not null
                 and p_level_order >= 1 and p_level_order <= p_level_count
           then coalesce(p_points, (p_level_count - p_level_order + 1)::numeric) end
  end;
$$;

revoke all on function public.analytics_mark_score(numeric, numeric, integer, integer, numeric, boolean) from public, anon;
grant execute on function public.analytics_mark_score(numeric, numeric, integer, integer, numeric, boolean) to authenticated;

create or replace function public.performance_group_aggregates(p_class_ids uuid[] default null)
returns table (
  class_id uuid, class_name text, subject_id uuid, subject_name text,
  year_id uuid, year_name text, year_start date, term_number integer,
  kind text, grading_scale_id uuid, level_count integer, n bigint, score_sum numeric
)
language sql
stable
set search_path = public
as $$
  with lv as (
    select b.grading_scale_id, max(b.level_order)::integer as n from public.grading_scale_bands b group by b.grading_scale_id
  ), scored as (
    select m.class_id, c.name as class_name, m.subject_id, s.name as subject_name,
           ay.id as year_id, ay.name as year_name, ay.start_date as year_start, t.term_number::integer as term_number,
           case when m.raw_score is not null then 'percent' else 'level' end as kind,
           case when m.raw_score is null then b.grading_scale_id end as grading_scale_id,
           case when m.raw_score is null then lv.n end as level_count,
           public.analytics_mark_score(m.raw_score, es.max_score, b.level_order::integer, lv.n, b.points, b.id is not null) as score
    from public.marks m
    join public.exams e on e.id = m.exam_id and e.status = 'closed'
    join public.terms t on t.id = e.term_id
    join public.academic_years ay on ay.id = t.academic_year_id
    join public.classes c on c.id = m.class_id
    join public.subjects s on s.id = m.subject_id
    left join public.exam_subjects es on es.exam_id = m.exam_id and es.class_id = m.class_id and es.subject_id = m.subject_id
    left join public.grading_scale_bands b on b.id = m.band_id
    left join lv on lv.grading_scale_id = b.grading_scale_id
    where (m.raw_score is not null or m.band_id is not null)
      and (p_class_ids is null or m.class_id = any (p_class_ids))
  )
  select sc.class_id, sc.class_name, sc.subject_id, sc.subject_name, sc.year_id, sc.year_name, sc.year_start, sc.term_number,
         sc.kind, sc.grading_scale_id, sc.level_count, count(*)::bigint, sum(sc.score)
  from scored sc
  where sc.score is not null
  group by sc.class_id, sc.class_name, sc.subject_id, sc.subject_name, sc.year_id, sc.year_name, sc.year_start, sc.term_number,
           sc.kind, sc.grading_scale_id, sc.level_count
  order by sc.year_start, sc.term_number, sc.class_name, sc.subject_name, sc.kind, sc.level_count nulls first;
$$;

create or replace function public.performance_student_aggregates(
  p_class_ids uuid[] default null,
  p_class_id uuid default null,
  p_subject_id uuid default null
)
returns table (
  student_id uuid, class_id uuid, class_name text,
  year_id uuid, year_name text, year_start date, term_number integer,
  kind text, grading_scale_id uuid, level_count integer, n bigint, score_sum numeric
)
language sql
stable
set search_path = public
as $$
  with lv as (
    select b.grading_scale_id, max(b.level_order)::integer as n from public.grading_scale_bands b group by b.grading_scale_id
  ), scored as (
    select m.student_id, m.class_id, c.name as class_name,
           ay.id as year_id, ay.name as year_name, ay.start_date as year_start, t.term_number::integer as term_number,
           case when m.raw_score is not null then 'percent' else 'level' end as kind,
           case when m.raw_score is null then b.grading_scale_id end as grading_scale_id,
           case when m.raw_score is null then lv.n end as level_count,
           public.analytics_mark_score(m.raw_score, es.max_score, b.level_order::integer, lv.n, b.points, b.id is not null) as score
    from public.marks m
    join public.exams e on e.id = m.exam_id and e.status = 'closed'
    join public.terms t on t.id = e.term_id
    join public.academic_years ay on ay.id = t.academic_year_id
    join public.classes c on c.id = m.class_id
    left join public.exam_subjects es on es.exam_id = m.exam_id and es.class_id = m.class_id and es.subject_id = m.subject_id
    left join public.grading_scale_bands b on b.id = m.band_id
    left join lv on lv.grading_scale_id = b.grading_scale_id
    where (m.raw_score is not null or m.band_id is not null)
      and (p_class_ids is null or m.class_id = any (p_class_ids))
      and (p_class_id is null or m.class_id = p_class_id)
      and (p_subject_id is null or m.subject_id = p_subject_id)
  )
  select sc.student_id, sc.class_id, sc.class_name, sc.year_id, sc.year_name, sc.year_start, sc.term_number,
         sc.kind, sc.grading_scale_id, sc.level_count, count(*)::bigint, sum(sc.score)
  from scored sc
  where sc.score is not null
  group by sc.student_id, sc.class_id, sc.class_name, sc.year_id, sc.year_name, sc.year_start, sc.term_number,
           sc.kind, sc.grading_scale_id, sc.level_count
  order by sc.student_id, sc.year_start, sc.term_number, sc.class_name, sc.kind, sc.level_count nulls first;
$$;

revoke all on function public.performance_group_aggregates(uuid[]) from public, anon;
grant execute on function public.performance_group_aggregates(uuid[]) to authenticated;
revoke all on function public.performance_student_aggregates(uuid[], uuid, uuid) from public, anon;
grant execute on function public.performance_student_aggregates(uuid[], uuid, uuid) to authenticated;
