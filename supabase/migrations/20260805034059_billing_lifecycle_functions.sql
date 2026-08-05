-- All billing management functions share one authorization check: platform
-- staff (auth_is_super_admin) or the service-role key used by the signup
-- route and the cron route (auth.role() = 'service_role'). No school user,
-- however senior, can activate/suspend/invoice their own school — mirrors
-- how a bursar cannot self-approve an expense, just at the platform tier.

create or replace function public.start_trial_subscription(
  p_school_id uuid,
  p_plan_id uuid,
  p_trial_days integer default 30
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub_id uuid;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to start a trial subscription.';
  end if;

  insert into school_subscriptions (school_id, plan_id, status, trial_ends_at)
  values (p_school_id, p_plan_id, 'trialing', now() + make_interval(days => p_trial_days))
  returning id into v_sub_id;

  update schools set status = 'trial', updated_at = now() where id = p_school_id;

  return v_sub_id;
end;
$$;
revoke all on function public.start_trial_subscription(uuid, uuid, integer) from public;
grant execute on function public.start_trial_subscription(uuid, uuid, integer) to authenticated;

create or replace function public.activate_subscription(
  p_school_id uuid,
  p_plan_id uuid,
  p_period_end date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to activate a subscription.';
  end if;

  update school_subscriptions
    set status = 'active', plan_id = p_plan_id,
        current_period_start = current_date, current_period_end = p_period_end,
        updated_at = now()
    where school_id = p_school_id;
  if not found then raise exception 'No subscription exists for this school yet.'; end if;

  update schools set status = 'active', updated_at = now() where id = p_school_id;
end;
$$;
revoke all on function public.activate_subscription(uuid, uuid, date) from public;
grant execute on function public.activate_subscription(uuid, uuid, date) to authenticated;

create or replace function public.suspend_subscription(p_school_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to suspend a subscription.';
  end if;

  update school_subscriptions
    set status = 'suspended', cancellation_reason = coalesce(p_reason, cancellation_reason), updated_at = now()
    where school_id = p_school_id;
  if not found then raise exception 'No subscription exists for this school.'; end if;

  update schools set status = 'suspended', updated_at = now() where id = p_school_id;
end;
$$;
revoke all on function public.suspend_subscription(uuid, text) from public;
grant execute on function public.suspend_subscription(uuid, text) to authenticated;

-- Cancellation may also be initiated by the school's own owner (self-serve
-- close-out), unlike every other billing action here.
create or replace function public.cancel_subscription(p_school_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (
    auth_is_super_admin()
    or auth.role() = 'service_role'
    or (auth_school_id() = p_school_id and auth_has_permission('billing.read'))
  ) then
    raise exception 'Not authorized to cancel this subscription.';
  end if;

  update school_subscriptions
    set status = 'cancelled', cancellation_reason = p_reason, updated_at = now()
    where school_id = p_school_id;
  if not found then raise exception 'No subscription exists for this school.'; end if;

  update schools set status = 'suspended', updated_at = now() where id = p_school_id;
end;
$$;
revoke all on function public.cancel_subscription(uuid, text) from public;
grant execute on function public.cancel_subscription(uuid, text) to authenticated;

create or replace function public.generate_platform_invoice(
  p_school_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub record;
  v_count integer;
  v_amount numeric;
  v_invoice_id uuid;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to generate a platform invoice.';
  end if;

  select id, plan_id into v_sub from school_subscriptions where school_id = p_school_id;
  if v_sub.id is null then raise exception 'No subscription exists for this school.'; end if;
  if v_sub.plan_id is null then raise exception 'School has no plan assigned — activate a subscription first.'; end if;

  select count(*) into v_count from students where school_id = p_school_id and status = 'active';
  select price_per_student_kes * v_count into v_amount from subscription_plans where id = v_sub.plan_id;

  insert into platform_invoices (school_id, subscription_id, period_start, period_end, student_count, amount_kes, due_at)
  values (p_school_id, v_sub.id, p_period_start, p_period_end, v_count, v_amount, now() + make_interval(days => p_due_days))
  returning id into v_invoice_id;

  return v_invoice_id;
end;
$$;
revoke all on function public.generate_platform_invoice(uuid, date, date, integer) from public;
grant execute on function public.generate_platform_invoice(uuid, date, date, integer) to authenticated;

create or replace function public.record_platform_payment(p_invoice_id uuid, p_reference text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to record a platform payment.';
  end if;

  update platform_invoices
    set status = 'paid', paid_at = now(), payment_reference = p_reference
    where id = p_invoice_id
    returning school_id into v_school_id;
  if v_school_id is null then raise exception 'Invoice not found.'; end if;

  update school_subscriptions
    set status = 'active', updated_at = now()
    where school_id = v_school_id and status in ('past_due','suspended');

  update schools set status = 'active', updated_at = now()
    where id = v_school_id and status = 'suspended';
end;
$$;
revoke all on function public.record_platform_payment(uuid, text) from public;
grant execute on function public.record_platform_payment(uuid, text) to authenticated;

-- Maintenance functions, meant to run on a schedule (no pg_cron in this
-- project — see Phase 2/4's carried-forward note; run via the /api/cron
-- route on Vercel Cron instead, using the service-role key).

create or replace function public.expire_trials()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to expire trials.';
  end if;

  with expired as (
    update school_subscriptions
      set status = 'past_due', updated_at = now()
      where status = 'trialing' and trial_ends_at < now()
      returning school_id
  )
  update schools set status = 'suspended', updated_at = now()
    where id in (select school_id from expired)
  returning 1 into v_count;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_trials() from public;
grant execute on function public.expire_trials() to authenticated;

create or replace function public.mark_invoices_overdue()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to mark invoices overdue.';
  end if;

  with overdue as (
    update platform_invoices
      set status = 'overdue'
      where status = 'issued' and due_at < now()
      returning subscription_id
  )
  update school_subscriptions
    set status = 'past_due', updated_at = now()
    where id in (select subscription_id from overdue) and status = 'active';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_invoices_overdue() from public;
grant execute on function public.mark_invoices_overdue() to authenticated;

create or replace function public.suspend_schools_with_overdue_invoices(p_grace_days integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to suspend schools.';
  end if;

  with to_suspend as (
    select distinct school_id from platform_invoices
      where status = 'overdue' and due_at < now() - make_interval(days => p_grace_days)
  )
  update schools set status = 'suspended', updated_at = now()
    where id in (select school_id from to_suspend) and status <> 'suspended';

  get diagnostics v_count = row_count;

  update school_subscriptions set status = 'suspended', updated_at = now()
    where school_id in (select school_id from platform_invoices
      where status = 'overdue' and due_at < now() - make_interval(days => p_grace_days))
    and status <> 'suspended';

  return v_count;
end;
$$;
revoke all on function public.suspend_schools_with_overdue_invoices(integer) from public;
grant execute on function public.suspend_schools_with_overdue_invoices(integer) to authenticated;
