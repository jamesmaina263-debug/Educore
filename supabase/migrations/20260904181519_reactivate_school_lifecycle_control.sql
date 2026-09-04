-- Platform admin gap: suspend_subscription() (20260805034059) lets platform staff suspend a
-- school in one call, but the only way back is activate_subscription(), which requires
-- re-picking a plan_id and a period_end -- fine for a brand-new activation, but heavier than
-- the common "they paid, un-suspend them" case, and today that reversal is only exposed via
-- Billing's expanded row, not the Overview school list (see chat/PR notes: "school lifecycle
-- controls ... directly from Overview's school list instead of only via SQL").
--
-- reactivate_school() is the lightweight counterpart to suspend_subscription(): it reuses the
-- school's existing school_subscriptions row (same plan -- Billing is still where you'd change
-- plans) and only extends current_period_end when it's missing or already in the past, using
-- the same per-billing-period month count the Overview KPI page already uses for MRR
-- (MONTHS_PER_BILLING_PERIOD in src/app/(admin)/admin/page.tsx) so the two stay consistent.
-- Left untouched if the period end is still in the future (e.g. suspended mid-period for a
-- policy reason unrelated to payment) -- reactivating shouldn't silently shorten what was
-- already paid for.
create or replace function public.reactivate_school(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub record;
  v_months integer;
  v_new_period_end date;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to reactivate a school.';
  end if;

  select * into v_sub from school_subscriptions where school_id = p_school_id;
  if not found then
    raise exception 'No subscription exists for this school yet -- activate one from Billing instead.';
  end if;

  v_months := case
    (select billing_period from subscription_plans where id = v_sub.plan_id)
    when 'monthly' then 1
    when 'annual' then 12
    else 4 -- termly, and the fallback if the plan was since deleted -- matches
           -- MONTHS_PER_BILLING_PERIOD's own default in the Overview page.
  end;

  v_new_period_end := case
    when v_sub.current_period_end is not null and v_sub.current_period_end > current_date
      then v_sub.current_period_end
    else (current_date + make_interval(months => v_months))::date
  end;

  update school_subscriptions
    set status = 'active', current_period_start = current_date, current_period_end = v_new_period_end,
        updated_at = now()
    where school_id = p_school_id;

  update schools set status = 'active', updated_at = now() where id = p_school_id;
end;
$$;
revoke all on function public.reactivate_school(uuid) from public;
grant execute on function public.reactivate_school(uuid) to authenticated;
