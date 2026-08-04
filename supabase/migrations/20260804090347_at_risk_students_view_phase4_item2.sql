-- Phase 4, Item 2: At-risk student identification — rule-based v1, per blueprint Phase 4 instruction
-- ("rule-based first"). Computed-on-read, same pattern as v_student_balances (Phase 2) rather than a
-- stored/cron-refreshed table, since there is still no pg_cron/pg_net job runner in this project
-- (flagged as a gap since Phase 2's Communication item and still true here).
--
-- Three rules, each independently documented and each a real, explainable signal rather than a
-- black-box score:
--   1. low_attendance          — present-rate over the trailing 30 days < 75%
--   2. low_academic_performance — most recent class_rankings.average_score (current active term
--                                  only) < 40
--   3. fee_overdue             — v_student_balances.balance > 0 AND the student's invoice was
--                                  created more than 30 days ago
-- risk_score = count of triggered rules (0-3); the view only returns rows with risk_score >= 1.
-- Thresholds (75%, 40, 30 days) are hardcoded constants for this v1, not school-configurable yet —
-- a real gap to flag for a future phase if schools want to tune them, not silently pretended away.

create view v_at_risk_students
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
      (case when ob.balance is not null and ob.balance > 0 then 1 else 0 end)
    ) as risk_score,
    array_remove(array[
      case when att.total_count > 0 and (100.0 * att.present_count / att.total_count) < 75 then 'low_attendance' end,
      case when lea.average_score is not null and lea.average_score < 40 then 'low_academic_performance' end,
      case when ob.balance is not null and ob.balance > 0 then 'fee_overdue' end
    ], null) as risk_reasons
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
  where st.status = 'active'
    and auth_has_permission('ai.read')
) risk
where risk_score >= 1;

comment on view v_at_risk_students is
  'Rule-based (v1) at-risk flagging: attendance <75% (trailing 30d), latest active-term class ranking average <40, or an overdue (>30d) positive balance. risk_score is the count of triggered rules; only score>=1 rows are returned. security_invoker=true inherits RLS from students/student_attendance/class_rankings/v_student_balances underneath; the auth_has_permission(''ai.read'') check additionally restricts this specific view to Owner/Principal (matches blueprint Part S.3 dashboard wireframe, which shows the AI-flagged at-risk widget for Owner/Principal only).';

revoke all on public.v_at_risk_students from public, anon;
grant select on public.v_at_risk_students to authenticated;
