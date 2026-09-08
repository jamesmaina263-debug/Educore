-- Extends v_at_risk_students (20260804090347) with a 4th, CBC-specific rule
-- (Performance Appraisal Engine directive, Step 12 / final dashboard).
--
-- v_at_risk_students already IS this project's "identify areas needing
-- support" engine (Phase 13's own language) for attendance/academic/fee
-- signals -- it predates the Step 5-11 competency-appraisal work entirely,
-- so it has no idea a student can be rated "Needs Support" on a core
-- competency/value/PCI. Extending it (CREATE OR REPLACE VIEW, same rule-
-- based/computed-on-read/security_invoker/ai.read-gated shape) is the
-- directive's own "extend, don't duplicate" instruction applied here --
-- a second, parallel risk view would just fragment the one place a
-- principal already looks for this.
--
-- Rule 4: needs_support_competency -- the student has at least one
-- competency_indicator_rating at the bottom band (level_order = 1, i.e.
-- "Needs Support" on the school's 3-2-1 scale) in the current active term.
-- Deliberately does NOT also fold in Step 7's rubric_criterion_scores or
-- Step 8's growth-trend "declining" signal here -- those are per-subject/
-- per-criterion granularity, not a single per-student flag, and belong on
-- the dashboard's own class-scoped views (see the app-layer changes in
-- this same PR) rather than diluting this already-broad rule-based view
-- with them.

create or replace view v_at_risk_students
with (security_invoker = true) as
select * from (
  select
    st.id as student_id,
    st.school_id,
    st.current_class_id,
    st.first_name,
    st.last_name,
    st.admission_number,
    att.present_count,
    att.total_count,
    case when att.total_count > 0
      then round(100.0 * att.present_count / att.total_count, 1)
      else null
    end as attendance_rate_30d,
    lea.average_score as latest_exam_average,
    ob.balance as overdue_balance,
    (
      (case when att.total_count > 0 and (100.0 * att.present_count / att.total_count) < 75 then 1 else 0 end) +
      (case when lea.average_score is not null and lea.average_score < 40 then 1 else 0 end) +
      (case when ob.balance is not null and ob.balance > 0 then 1 else 0 end) +
      (case when nsc.flagged_indicators is not null then 1 else 0 end)
    ) as risk_score,
    array_remove(array[
      case when att.total_count > 0 and (100.0 * att.present_count / att.total_count) < 75 then 'low_attendance' end,
      case when lea.average_score is not null and lea.average_score < 40 then 'low_academic_performance' end,
      case when ob.balance is not null and ob.balance > 0 then 'fee_overdue' end,
      case when nsc.flagged_indicators is not null then 'needs_support_competency' end
    ], null) as risk_reasons,
    nsc.flagged_indicators as needs_support_competencies
  from students st
  left join lateral (
    select
      count(*) filter (where sa.status = 'present') as present_count,
      count(*) as total_count
    from student_attendance sa
    where sa.student_id = st.id
      and sa.attendance_date >= (current_date - interval '30 days')
  ) att on true
  left join lateral (
    select cr.average_score
    from class_rankings cr
    join exams e on e.id = cr.exam_id
    join terms t on t.id = e.term_id
    where cr.student_id = st.id
      and t.status = 'active'
    order by cr.computed_at desc
    limit 1
  ) lea on true
  left join lateral (
    select b.balance
    from v_student_balances b
    where b.student_id = st.id
      and b.balance > 0
      and exists (
        select 1 from invoices i
        where i.student_id = st.id
          and i.created_at <= (now() - interval '30 days')
      )
  ) ob on true
  left join lateral (
    select array_agg(distinct ci.name order by ci.name) as flagged_indicators
    from competency_indicator_ratings cir
    join competency_indicators ci on ci.id = cir.indicator_id
    join grading_scale_bands gsb on gsb.id = cir.band_id
    join terms t on t.id = cir.term_id
    where cir.student_id = st.id
      and t.status = 'active'
      and gsb.level_order = 1
  ) nsc on true
  where st.status = 'active'
    and auth_has_permission('ai.read')
) risk
where risk_score >= 1;

comment on view v_at_risk_students is
  'Rule-based (v1) at-risk flagging: attendance <75% (trailing 30d), latest active-term class ranking average <40, an overdue (>30d) positive balance, or at least one bottom-band ("Needs Support") core-competency/value/PCI rating in the active term. risk_score is the count of triggered rules (0-4); only score>=1 rows are returned. needs_support_competencies lists the flagged indicator names when that rule triggered. security_invoker=true inherits RLS from students/student_attendance/class_rankings/v_student_balances/competency_indicator_ratings underneath; the auth_has_permission(''ai.read'') check additionally restricts this specific view to Owner/Principal.';
