
-- Balances are computed on read (blueprint Part D), not stored/cached — avoids an entire class of
-- "stale balance" bugs for the sake of a premature optimization. security_invoker=true is essential
-- here: without it the view would run with the view-owner's privileges and silently bypass every
-- RLS policy on invoices/discounts/payment_allocations/students underneath it.
create view v_student_balances
with (security_invoker = true) as
select
  st.id as student_id,
  st.school_id,
  st.current_class_id as stream_id,
  coalesce(inv_totals.total_invoiced, 0) as total_invoiced,
  coalesce(disc_totals.total_discounted, 0) as total_discounted,
  coalesce(pay_totals.total_paid, 0) as total_paid,
  coalesce(inv_totals.total_invoiced, 0) - coalesce(disc_totals.total_discounted, 0) - coalesce(pay_totals.total_paid, 0) as balance
from students st
left join lateral (
  select sum(total_amount) as total_invoiced from invoices where student_id = st.id
) inv_totals on true
left join lateral (
  select sum(d.amount) as total_discounted
  from discounts d
  join invoices i on i.id = d.invoice_id
  where i.student_id = st.id and d.status = 'approved'
) disc_totals on true
left join lateral (
  select sum(pa.amount_allocated) as total_paid
  from payment_allocations pa
  join invoices i on i.id = pa.invoice_id
  where i.student_id = st.id
) pay_totals on true;

comment on view v_student_balances is 'Computed-on-read balance per student: total_invoiced - total_discounted (approved only) - total_paid (allocated). security_invoker=true so it inherits the querying role''s RLS on every underlying table — a parent querying this view only ever sees their own child''s row, same as querying invoices directly.';
