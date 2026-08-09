-- Read-only cross-campus rollup for a group_admin. SECURITY DEFINER because it deliberately
-- crosses school_id RLS boundaries; self-scopes to the caller's own group and re-checks the
-- permission internally rather than trusting the grant alone, same defense-in-depth pattern
-- as v_at_risk_students/v_fee_collection_forecast in Phase 4.
create or replace function public.group_schools_summary()
returns table (
  school_id uuid,
  school_name text,
  active_students integer,
  fee_collection_rate numeric,
  attendance_rate_today numeric
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
    ), 0)
  from schools s
  where s.school_group_id = v_group_id;
end;
$function$;

-- NOTE: original grant here was later tightened by phase5_advisor_fixes.sql (revoked from
-- anon/public, granted to authenticated only) -- kept as originally applied for an accurate
-- migration history; see that later file for the fix.
grant execute on function public.group_schools_summary() to authenticated;
