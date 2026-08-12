-- Phase 16 (Brief 4.17/4.20): Reports must be filterable by campus for an authorized
-- (group_admin) admin, and Finance/Reports consolidated cross-campus visibility should
-- extend the existing Phase 5 pattern rather than build a second engine.
--
-- Phase 5's group_schools_summary() deliberately shipped as a fixed, whole-group rollup
-- (read-only aggregate functions only, not blanket cross-school RLS — documented design
-- decision, see 20260808080728). This migration extends that SAME function rather than
-- creating a parallel one: adds an optional p_school_id filter (null = every campus in the
-- group, same as today; a specific id = that one campus only) and one more column,
-- outstanding_balance, so Reports' campus selector and /campuses' existing table can both
-- keep using it. Signature change (added trailing optional param + new output column) is
-- backward compatible with the existing no-arg call site in /campuses.

create or replace function public.group_schools_summary(p_school_id uuid default null)
returns table (
  school_id uuid,
  school_name text,
  active_students integer,
  fee_collection_rate numeric,
  attendance_rate_today numeric,
  outstanding_balance numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_group_id uuid := public.auth_group_id();
begin
  if v_group_id is null or not public.auth_has_permission('group.reports.read') then
    return;
  end if;

  return query
  select
    s.id,
    s.name,
    (select count(*)::int from students st where st.school_id = s.id and st.status = 'active'),
    coalesce((
      select case when sum(i.total_amount) > 0
        then round(100 * sum(coalesce(pa.paid,0)) / sum(i.total_amount), 1)
        else 0 end
      from invoices i
      left join (
        select pal.invoice_id, sum(pal.amount_allocated) as paid
        from payment_allocations pal
        group by pal.invoice_id
      ) pa on pa.invoice_id = i.id
      where i.school_id = s.id
    ), 0),
    coalesce((
      select round(100.0 * count(*) filter (where sa.status = 'present') / nullif(count(*),0), 1)
      from student_attendance sa
      where sa.school_id = s.id and sa.attendance_date = current_date
    ), 0),
    -- Aggregate approximation, same honesty convention as the fee-forecast heuristic: total
    -- invoiced minus total paid minus total approved discounts, summed at the school level
    -- (not netted per-invoice like v_student_balances does). Good enough for a cross-campus
    -- eyeball total; not a substitute for the per-student Finance balances view.
    coalesce((
      select greatest(0, sum(i.total_amount) - sum(coalesce(pa.paid,0)) - sum(coalesce(d.discounted,0)))
      from invoices i
      left join (
        select pal.invoice_id, sum(pal.amount_allocated) as paid
        from payment_allocations pal
        group by pal.invoice_id
      ) pa on pa.invoice_id = i.id
      left join (
        select disc.invoice_id, sum(disc.amount) as discounted
        from discounts disc
        where disc.status = 'approved'
        group by disc.invoice_id
      ) d on d.invoice_id = i.id
      where i.school_id = s.id
    ), 0)
  from schools s
  where s.school_group_id = v_group_id
    and (p_school_id is null or s.id = p_school_id);
end;
$function$;

grant execute on function public.group_schools_summary(uuid) to authenticated;
