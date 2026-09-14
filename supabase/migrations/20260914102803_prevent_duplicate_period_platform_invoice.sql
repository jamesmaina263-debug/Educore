-- generate_platform_invoice had no protection against being called twice for
-- the same school + overlapping period -- caught live on Gititu High Schoool:
-- two 2,000 KES invoices for the identical 2026-09-14..2026-10-14 period,
-- 14 seconds apart (a double-click on "Generate invoice"), one paid and one
-- left dangling as 'issued'. That dangling duplicate would have aged into
-- the dunning list and eventually driven an unwarranted suspension.
--
-- Fix: reject generation when a non-cancelled invoice already exists for
-- that school with an overlapping period. Overlap uses the standard
-- [start, end) test: existing.start < new.end and existing.end > new.start.

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
  v_existing_id uuid;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to generate a platform invoice.';
  end if;

  select id, plan_id into v_sub from school_subscriptions where school_id = p_school_id;
  if v_sub.id is null then raise exception 'No subscription exists for this school.'; end if;
  if v_sub.plan_id is null then raise exception 'School has no plan assigned — activate a subscription first.'; end if;

  select id into v_existing_id
    from platform_invoices
    where school_id = p_school_id
      and status <> 'cancelled'
      and period_start < p_period_end
      and period_end > p_period_start
    limit 1;
  if v_existing_id is not null then
    raise exception
      'An invoice already exists for this school covering an overlapping period (invoice %). Cancel it first if this was a mistake, or pick a non-overlapping period.',
      v_existing_id;
  end if;

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

-- Clean up the live duplicate this guard is closing: Gititu's already-paid
-- invoice for 2026-09-14..2026-10-14 has a stray unpaid twin. Cancel the
-- twin rather than deleting it, to keep the audit trail.
update platform_invoices
  set status = 'cancelled'
  where id = 'd42d5461-169b-4000-b71d-83a91bb8a7ba'
    and status = 'issued';
