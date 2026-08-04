-- Phase 4, Item 3: Fee collection predictive insights — simple linear-trend heuristic, not a
-- trained model. Documented plainly as a heuristic (blueprint Phase 4 says "predictive insights",
-- but v1 of everything else in this phase is rule-based; a real forecasting model needs a lot more
-- historical terms of data than a brand-new platform has, so a linear projection is the honest v1).
--
-- Method: for the active term, take the collection rate achieved so far (total collected / days
-- elapsed since term start) and project it forward across the days remaining in the term. This is
-- the simplest defensible projection given the data available today — flagged, not disguised as
-- more sophisticated than it is.

create view v_fee_collection_forecast
with (security_invoker = true) as
select
  t.id as term_id,
  t.school_id,
  t.name as term_name,
  t.start_date,
  t.end_date,
  coalesce(inv.total_invoiced, 0) as total_invoiced,
  coalesce(pay.total_collected, 0) as total_collected,
  greatest(least(current_date, t.end_date) - t.start_date, 1) as days_elapsed,
  greatest(t.end_date - greatest(current_date, t.start_date), 0) as days_remaining,
  case when coalesce(inv.total_invoiced, 0) > 0
    then round(100.0 * coalesce(pay.total_collected, 0) / inv.total_invoiced, 1)
    else null
  end as current_collection_rate_pct,
  case when greatest(least(current_date, t.end_date) - t.start_date, 1) > 0
    then round(coalesce(pay.total_collected, 0) / greatest(least(current_date, t.end_date) - t.start_date, 1), 2)
    else 0
  end as daily_collection_rate,
  round(
    coalesce(pay.total_collected, 0) +
    (case when greatest(least(current_date, t.end_date) - t.start_date, 1) > 0
       then coalesce(pay.total_collected, 0) / greatest(least(current_date, t.end_date) - t.start_date, 1)
       else 0
     end) * greatest(t.end_date - greatest(current_date, t.start_date), 0)
  , 2) as projected_total_collected,
  case when coalesce(inv.total_invoiced, 0) > 0
    then round(100.0 * (
      coalesce(pay.total_collected, 0) +
      (case when greatest(least(current_date, t.end_date) - t.start_date, 1) > 0
         then coalesce(pay.total_collected, 0) / greatest(least(current_date, t.end_date) - t.start_date, 1)
         else 0
       end) * greatest(t.end_date - greatest(current_date, t.start_date), 0)
    ) / inv.total_invoiced, 1)
    else null
  end as projected_collection_rate_pct
from terms t
left join lateral (
  select sum(i.total_amount) as total_invoiced
  from invoices i
  where i.term_id = t.id
) inv on true
left join lateral (
  select sum(pa.amount_allocated) as total_collected
  from payment_allocations pa
  join invoices i on i.id = pa.invoice_id
  where i.term_id = t.id
) pay on true
where t.status = 'active'
  and auth_has_permission('ai.read');

comment on view v_fee_collection_forecast is
  'Linear-trend fee collection projection for the active term: current daily collection rate (collected so far / days elapsed) extrapolated across the days remaining. A heuristic, not a trained forecasting model — flagged deliberately per Green Light Policy honesty, not dressed up as more sophisticated than it is. Gated to ai.read (Owner/Principal) since it surfaces finance figures, same tier as v_at_risk_students.';

revoke all on public.v_fee_collection_forecast from public, anon;
grant select on public.v_fee_collection_forecast to authenticated;
