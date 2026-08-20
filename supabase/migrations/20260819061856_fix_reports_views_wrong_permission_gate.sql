-- v_fee_collection_forecast and v_at_risk_students both hardcoded
-- `auth_has_permission('ai.read')` in their WHERE clause -- a leftover from
-- when they were built specifically for the AI module. Both are also
-- consumed by Reports (gated on `reports.read`) and, for at-risk students,
-- also referenced from other module code -- none of which necessarily
-- implies `ai.read`. Currently not live-exploitable (every role holding
-- `reports.read` or `finance.read` also happens to hold `ai.read` today),
-- but it's the exact "confident empty result instead of an honest refusal"
-- anti-pattern the AI module's own per-intent permission checks (Phase 16)
-- were built to avoid -- baked into the view itself, for callers who were
-- never meant to need that specific permission.
--
-- Their sibling views (v_student_balances, v_transport_route_capacity) get
-- this right already: security_invoker=true, no feature-specific gate,
-- relying purely on RLS on the underlying tables. Bringing both views in
-- line with that convention -- each caller (AI's per-intent checks,
-- Reports' page-level reports.read gate) already does its own correct
-- authorization; the view has no business re-gating on a stranger's
-- permission underneath that.
CREATE OR REPLACE VIEW public.v_fee_collection_forecast
WITH (security_invoker = true) AS
 SELECT t.id AS term_id,
    t.school_id,
    t.name AS term_name,
    t.start_date,
    t.end_date,
    COALESCE(inv.total_invoiced, 0::numeric) AS total_invoiced,
    COALESCE(pay.total_collected, 0::numeric) AS total_collected,
    GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1) AS days_elapsed,
    GREATEST(t.end_date - GREATEST(CURRENT_DATE, t.start_date), 0) AS days_remaining,
        CASE
            WHEN COALESCE(inv.total_invoiced, 0::numeric) > 0::numeric THEN round(100.0 * COALESCE(pay.total_collected, 0::numeric) / inv.total_invoiced, 1)
            ELSE NULL::numeric
        END AS current_collection_rate_pct,
        CASE
            WHEN GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1) > 0 THEN round(COALESCE(pay.total_collected, 0::numeric) / GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1)::numeric, 2)
            ELSE 0::numeric
        END AS daily_collection_rate,
    round(COALESCE(pay.total_collected, 0::numeric) +
        CASE
            WHEN GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1) > 0 THEN COALESCE(pay.total_collected, 0::numeric) / GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1)::numeric
            ELSE 0::numeric
        END * GREATEST(t.end_date - GREATEST(CURRENT_DATE, t.start_date), 0)::numeric, 2) AS projected_total_collected,
        CASE
            WHEN COALESCE(inv.total_invoiced, 0::numeric) > 0::numeric THEN round(100.0 * (COALESCE(pay.total_collected, 0::numeric) +
            CASE
                WHEN GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1) > 0 THEN COALESCE(pay.total_collected, 0::numeric) / GREATEST(LEAST(CURRENT_DATE, t.end_date) - t.start_date, 1)::numeric
                ELSE 0::numeric
            END * GREATEST(t.end_date - GREATEST(CURRENT_DATE, t.start_date), 0)::numeric) / inv.total_invoiced, 1)
            ELSE NULL::numeric
        END AS projected_collection_rate_pct
   FROM terms t
     LEFT JOIN LATERAL ( SELECT sum(i.total_amount) AS total_invoiced
           FROM invoices i
          WHERE i.term_id = t.id) inv ON true
     LEFT JOIN LATERAL ( SELECT sum(pa.amount_allocated) AS total_collected
           FROM payment_allocations pa
             JOIN invoices i ON i.id = pa.invoice_id
          WHERE i.term_id = t.id) pay ON true
  WHERE t.status = 'active'::text;

CREATE OR REPLACE VIEW public.v_at_risk_students
WITH (security_invoker = true) AS
SELECT student_id, school_id, current_class_id, first_name, last_name, admission_number,
    present_count, total_count, attendance_rate_30d, latest_exam_average, overdue_balance,
    risk_score, risk_reasons
   FROM ( SELECT st.id AS student_id,
            st.school_id,
            st.current_class_id,
            st.first_name,
            st.last_name,
            st.admission_number,
            att.present_count,
            att.total_count,
                CASE
                    WHEN att.total_count > 0 THEN round(100.0 * att.present_count::numeric / att.total_count::numeric, 1)
                    ELSE NULL::numeric
                END AS attendance_rate_30d,
            lea.average_score AS latest_exam_average,
            ob.balance AS overdue_balance,
                CASE
                    WHEN att.total_count > 0 AND (100.0 * att.present_count::numeric / att.total_count::numeric) < 75::numeric THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN lea.average_score IS NOT NULL AND lea.average_score < 40::numeric THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN ob.balance IS NOT NULL AND ob.balance > 0::numeric THEN 1
                    ELSE 0
                END AS risk_score,
            array_remove(ARRAY[
                CASE
                    WHEN att.total_count > 0 AND (100.0 * att.present_count::numeric / att.total_count::numeric) < 75::numeric THEN 'low_attendance'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN lea.average_score IS NOT NULL AND lea.average_score < 40::numeric THEN 'low_academic_performance'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ob.balance IS NOT NULL AND ob.balance > 0::numeric THEN 'fee_overdue'::text
                    ELSE NULL::text
                END], NULL::text) AS risk_reasons
           FROM students st
             LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE sa.status = 'present'::text) AS present_count,
                    count(*) AS total_count
                   FROM student_attendance sa
                  WHERE sa.student_id = st.id AND sa.attendance_date >= (CURRENT_DATE - '30 days'::interval)) att ON true
             LEFT JOIN LATERAL ( SELECT cr.average_score
                   FROM class_rankings cr
                     JOIN exams e ON e.id = cr.exam_id
                     JOIN terms t ON t.id = e.term_id
                  WHERE cr.student_id = st.id AND t.status = 'active'::text
                  ORDER BY cr.computed_at DESC
                 LIMIT 1) lea ON true
             LEFT JOIN LATERAL ( SELECT b.balance
                   FROM v_student_balances b
                  WHERE b.student_id = st.id AND b.balance > 0::numeric AND (EXISTS ( SELECT 1
                           FROM invoices i
                          WHERE i.student_id = st.id AND i.created_at <= (now() - '30 days'::interval)))) ob ON true
          WHERE st.status = 'active'::text) risk
  WHERE risk_score >= 1;
