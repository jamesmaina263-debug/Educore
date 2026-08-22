-- Phase 30, Item 1: Predictive analytics beyond canned intents — part 1, model-based risk scoring.
--
-- v_at_risk_students (Phase 4, Item 2) counts triggered rules (0-3). This adds a second, richer
-- signal: student_risk_scores, a continuous 0-100 score computed from *weighted* factors,
-- including trend (is attendance/exam performance getting worse, not just currently low) and
-- payment lateness in days (not just "has any overdue balance").
--
-- Honesty note (Green Light Policy, same as the fee-collection-forecast comment): the weights
-- below are hand-set, not fit on historical outcome data. This is a brand-new platform with no
-- accumulated "did this student actually withdraw" labels to train on yet. student_risk_scores
-- is deliberately structured so that once a school has a few terms of withdrawal/transfer history,
-- the weights in risk_model_versions can be replaced by fitted logistic-regression coefficients
-- (see scripts/fit_risk_weights.py) without touching this schema or the call sites that read it —
-- only the row in risk_model_versions and the constants inside recompute_student_risk_scores()
-- change. Until then this is a documented heuristic, not a trained model, and is presented to
-- users as such (see the AI intent wording in ai/actions.ts).

create table public.risk_model_versions (
  version text primary key,
  method text not null check (method in ('hand_weighted', 'fitted_logistic_regression')),
  weights jsonb not null,
  notes text,
  created_at timestamptz not null default now()
);
comment on table public.risk_model_versions is
  'One row per scoring method ever used. student_risk_scores.model_version references this so every stored score is traceable to the exact weights that produced it — required for the "never dressed up as more sophisticated than it is" rule to be checkable later, not just asserted in a comment.';

insert into public.risk_model_versions (version, method, weights, notes) values (
  'v2-hand-weighted-2026-08',
  'hand_weighted',
  '{
    "attendance_level": 0.30,
    "attendance_trend": 0.15,
    "academic_level": 0.25,
    "academic_trend": 0.10,
    "payment_lateness_days": 0.15,
    "open_discipline_cases": 0.05
  }'::jsonb,
  'Weights chosen by domain judgment (attendance and academic level weighted highest, matching the Phase 4 rule-based view''s own factor choice), not fit on data. Superseded when a school has enough withdrawal-outcome history — see scripts/fit_risk_weights.py.'
);

create table public.student_risk_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  model_version text not null references public.risk_model_versions(version),
  risk_score numeric(5,2) not null check (risk_score >= 0 and risk_score <= 100),
  risk_band text not null check (risk_band in ('low', 'medium', 'high')),
  factors jsonb not null,
  computed_at timestamptz not null default now(),
  unique (student_id)
);
comment on table public.student_risk_scores is
  'One current row per active student (upserted, not history — same "latest snapshot" shape as v_fee_collection_forecast). factors holds the raw per-signal values (attendance_rate_30d, attendance_rate_prior_30d, latest_exam_average, prior_exam_average, overdue_days, open_discipline_cases) that produced risk_score, for the "why" behind any answer that cites it.';

create index idx_student_risk_scores_school_band on public.student_risk_scores(school_id, risk_band);

alter table public.student_risk_scores enable row level security;

-- Same gate as low_attendance_students/at_risk_count's underlying data in ai/actions.ts today —
-- this is student-level risk data, so students.read is the right permission, not a new one.
create policy student_risk_scores_select on public.student_risk_scores
  for select using (school_id = auth_school_id() and auth_has_permission('students.read'));

-- No insert/update/delete policy for `authenticated` — written only by
-- recompute_student_risk_scores() below (service_role / super_admin), same immutable-to-callers
-- convention as ai_query_logs and school_subscriptions' cron-maintained columns.
revoke all on public.student_risk_scores from public, anon;
grant select on public.student_risk_scores to authenticated;

revoke all on public.risk_model_versions from public, anon;
grant select on public.risk_model_versions to authenticated;

-- Recomputes every active student's risk score. p_school_id null = every school (the nightly
-- cron's use case); a specific school_id = a manual "recompute now" trigger from a Reports action
-- gated on ai.read, the same split expire_trials/mark_invoices_overdue use for platform-wide vs
-- targeted maintenance calls. Restricted to service_role/super_admin exactly like expire_trials —
-- no `authenticated` caller should be able to force a recompute on arbitrary schedule/cost.
create or replace function public.recompute_student_risk_scores(p_school_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
  v_model_version text := 'v2-hand-weighted-2026-08';
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to recompute risk scores.';
  end if;

  with features as (
    select
      st.id as student_id,
      st.school_id,
      coalesce(att.rate_30d, 100) as attendance_rate_30d,
      coalesce(att.rate_prior_30d, att.rate_30d, 100) as attendance_rate_prior_30d,
      lea.average_score as latest_exam_average,
      prev.average_score as prior_exam_average,
      coalesce(ob.max_overdue_days, 0) as overdue_days,
      coalesce(disc.open_count, 0) as open_discipline_cases
    from students st
    left join lateral (
      select
        case when count(*) > 0
          then round(100.0 * count(*) filter (where sa.status = 'present') / count(*), 1)
          else null end as rate_30d,
        case when count(*) filter (where sa.attendance_date < current_date - interval '30 days') > 0
          then round(100.0 *
            count(*) filter (where sa.status = 'present' and sa.attendance_date < current_date - interval '30 days')
            / count(*) filter (where sa.attendance_date < current_date - interval '30 days'), 1)
          else null end as rate_prior_30d
      from student_attendance sa
      where sa.student_id = st.id
        and sa.attendance_date >= current_date - interval '60 days'
    ) att on true
    left join lateral (
      select cr.average_score
      from class_rankings cr
      join exams e on e.id = cr.exam_id
      join terms t on t.id = e.term_id
      where cr.student_id = st.id and t.status = 'active'
      order by cr.computed_at desc
      limit 1
    ) lea on true
    left join lateral (
      select cr.average_score
      from class_rankings cr
      join exams e on e.id = cr.exam_id
      join terms t on t.id = e.term_id
      where cr.student_id = st.id and t.status = 'active'
      order by cr.computed_at desc
      offset 1 limit 1
    ) prev on true
    left join lateral (
      select max(extract(day from now() - i.created_at))::int as max_overdue_days
      from invoices i
      join v_student_balances b on b.student_id = i.student_id
      where i.student_id = st.id
        and b.balance > 0
        and i.created_at <= now() - interval '30 days'
    ) ob on true
    left join lateral (
      select count(*) as open_count
      from discipline_cases dc
      where dc.student_id = st.id
        and dc.status in ('open', 'investigating', 'pending_action')
    ) disc on true
    where st.status = 'active'
      and (p_school_id is null or st.school_id = p_school_id)
  ),
  scored as (
    select
      f.*,
      -- Each term below is 0-100 "badness"; combined with the weights in risk_model_versions.
      greatest(0, 100 - attendance_rate_30d) as attendance_level_badness,
      greatest(0, least(100, (attendance_rate_prior_30d - attendance_rate_30d) * 2)) as attendance_trend_badness,
      case when latest_exam_average is null then 30 -- no exam yet this term: mild, not zero, uncertainty
           else greatest(0, 100 - latest_exam_average) end as academic_level_badness,
      case when latest_exam_average is null or prior_exam_average is null then 0
           else greatest(0, least(100, (prior_exam_average - latest_exam_average) * 2)) end as academic_trend_badness,
      least(100, overdue_days / 1.2) as payment_lateness_badness,
      least(100, open_discipline_cases * 25) as discipline_badness
    from features f
  )
  insert into public.student_risk_scores (school_id, student_id, model_version, risk_score, risk_band, factors, computed_at)
  select
    s.school_id,
    s.student_id,
    v_model_version,
    round(
      0.30 * attendance_level_badness +
      0.15 * attendance_trend_badness +
      0.25 * academic_level_badness +
      0.10 * academic_trend_badness +
      0.15 * payment_lateness_badness +
      0.05 * discipline_badness
    , 2) as risk_score,
    case
      when (0.30 * attendance_level_badness + 0.15 * attendance_trend_badness + 0.25 * academic_level_badness
            + 0.10 * academic_trend_badness + 0.15 * payment_lateness_badness + 0.05 * discipline_badness) >= 60 then 'high'
      when (0.30 * attendance_level_badness + 0.15 * attendance_trend_badness + 0.25 * academic_level_badness
            + 0.10 * academic_trend_badness + 0.15 * payment_lateness_badness + 0.05 * discipline_badness) >= 30 then 'medium'
      else 'low'
    end as risk_band,
    jsonb_build_object(
      'attendance_rate_30d', attendance_rate_30d,
      'attendance_rate_prior_30d', attendance_rate_prior_30d,
      'latest_exam_average', latest_exam_average,
      'prior_exam_average', prior_exam_average,
      'overdue_days', overdue_days,
      'open_discipline_cases', open_discipline_cases
    ),
    now()
  from scored s
  on conflict (student_id) do update set
    school_id = excluded.school_id,
    model_version = excluded.model_version,
    risk_score = excluded.risk_score,
    risk_band = excluded.risk_band,
    factors = excluded.factors,
    computed_at = excluded.computed_at;

  get diagnostics v_count = row_count;

  -- Students no longer active shouldn't keep stale scores around indefinitely.
  delete from public.student_risk_scores srs
  where (p_school_id is null or srs.school_id = p_school_id)
    and not exists (select 1 from students st where st.id = srs.student_id and st.status = 'active');

  return v_count;
end;
$$;

revoke all on function public.recompute_student_risk_scores(uuid) from public;
grant execute on function public.recompute_student_risk_scores(uuid) to authenticated;

-- Read-side view, same shape/convention as v_at_risk_students: security_invoker, no
-- feature-specific permission baked in (the table's own RLS policy above already gates this on
-- students.read — baking a second gate in here would repeat the exact bug the
-- fix_reports_views_wrong_permission_gate migration fixed on the sibling views).
create view public.v_predicted_at_risk_students
with (security_invoker = true) as
select
  srs.student_id,
  srs.school_id,
  st.first_name,
  st.last_name,
  st.admission_number,
  st.current_class_id,
  srs.risk_score,
  srs.risk_band,
  srs.model_version,
  srs.factors,
  srs.computed_at
from public.student_risk_scores srs
join public.students st on st.id = srs.student_id
where srs.risk_band in ('medium', 'high')
order by srs.risk_score desc;

comment on view public.v_predicted_at_risk_students is
  'Model-based (v2, hand-weighted — see risk_model_versions) counterpart to v_at_risk_students''s rule-count (v1). Continuous risk_score (0-100) with trend and lateness-in-days factored in, not just current-value threshold checks. Populated by recompute_student_risk_scores(), run nightly via /api/cron/risk-scoring (Vercel Cron — no pg_cron in this project, same convention as the billing cron functions).';

revoke all on public.v_predicted_at_risk_students from public, anon;
grant select on public.v_predicted_at_risk_students to authenticated;
