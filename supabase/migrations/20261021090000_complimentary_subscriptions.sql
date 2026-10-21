-- Complimentary (no-charge) subscriptions, e.g. verified children's homes / orphanages.
--
-- Why an explicit flag: "no charge" must survive every billing path, not just a KES 0 price. Today:
--   * expire_trials() suspends any school whose subscription is still 'trialing' when the 30 days end.
--   * the automated cycle planner would issue KES 0 invoices to an active school (noise; the overdue sweep
--     already ignores zero-balance invoices, so this never suspends anyone, but an invoice for KES 0 is wrong).
--   * generate_platform_invoice() would let an admin issue one by hand.
-- This migration adds the flag and makes those three paths respect it. Nothing is changed for any existing
-- school: the new column defaults to false and no row is updated here.
--
-- Safety posture:
--   * Additive and safe to run twice.
--   * Only a platform super admin can set the flag (school_subscriptions writes are already super-admin only
--     by RLS; the RPC also checks it). A school can never flag itself.
--   * The reason is readable by school staff who hold billing.read (they can already read their own
--     subscription row), so keep it factual.

-- ============================================================
-- 1. Columns
-- ============================================================
alter table public.school_subscriptions
  add column if not exists complimentary boolean not null default false,
  add column if not exists complimentary_reason text,
  add column if not exists complimentary_set_at timestamptz,
  add column if not exists complimentary_set_by uuid references auth.users(id) on delete set null;

alter table public.school_subscriptions drop constraint if exists school_subscriptions_complimentary_reason_check;
alter table public.school_subscriptions
  add constraint school_subscriptions_complimentary_reason_check
  check (not complimentary or (complimentary_reason is not null and char_length(btrim(complimentary_reason)) between 3 and 300));

comment on column public.school_subscriptions.complimentary is 'True = this school is not charged (verified children''s home etc.). Skipped by trial expiry, the automated invoice planner and manual invoice generation. Set only through set_school_complimentary().';

-- ============================================================
-- 2. Super-admin RPC to set / clear the flag
-- ============================================================
create or replace function public.set_school_complimentary(
  p_school_id uuid, p_complimentary boolean, p_reason text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub public.school_subscriptions%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not auth_is_super_admin() then raise exception 'Not authorized to change a school''s billing terms.'; end if;
  if p_complimentary is null then raise exception 'Choose whether the school is complimentary.'; end if;

  select * into v_sub from public.school_subscriptions where school_id = p_school_id for update;
  if v_sub.id is null then raise exception 'No subscription exists for this school.'; end if;

  if p_complimentary then
    if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
      raise exception 'Give a short reason (3-300 characters), e.g. how the children''s home was verified.';
    end if;
    if v_sub.status = 'cancelled' then
      raise exception 'This subscription was cancelled. Reactivate it before making it complimentary.';
    end if;

    -- Active, KES 0, never expires. The 30-day trial no longer applies, so a trial that has already lapsed
    -- (school suspended by expire_trials) is reopened as part of this explicit admin action.
    update public.school_subscriptions set
      complimentary = true, complimentary_reason = v_reason,
      complimentary_set_at = now(), complimentary_set_by = auth.uid(),
      status = 'active', price_override_kes = 0,
      current_period_start = coalesce(current_period_start, (now() at time zone 'Africa/Nairobi')::date),
      updated_at = now()
    where id = v_sub.id;

    update public.schools set status = 'active', updated_at = now()
      where id = p_school_id and status in ('trial', 'suspended');
  else
    -- Back to a normal school: clear the flag and the KES 0 price we set, nothing else. The subscription
    -- stays active with whatever plan it has; an admin assigns a plan / terms next (the invoice planner
    -- skips a school with no plan, so nothing is billed by surprise).
    update public.school_subscriptions set
      complimentary = false, complimentary_reason = null, complimentary_set_at = null, complimentary_set_by = null,
      price_override_kes = case when price_override_kes = 0 then null else price_override_kes end,
      updated_at = now()
    where id = v_sub.id;
  end if;
end;
$$;
revoke all on function public.set_school_complimentary(uuid, boolean, text) from public, anon;
grant execute on function public.set_school_complimentary(uuid, boolean, text) to authenticated, service_role;

-- ============================================================
-- 3. expire_trials: never expire a complimentary school
-- ============================================================
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
      where status = 'trialing' and trial_ends_at < now() and not complimentary
      returning school_id
  )
  update schools set status = 'suspended', updated_at = now()
    where id in (select school_id from expired)
  returning 1 into v_count;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 4. Manual invoice generation refuses a complimentary school
-- ============================================================
create or replace function public.generate_platform_invoice(
  p_school_id uuid, p_period_start date, p_period_end date, p_due_days integer default 14
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to generate a platform invoice.';
  end if;
  if exists (select 1 from public.school_subscriptions where school_id = p_school_id and complimentary) then
    raise exception 'This school is complimentary (no charge) and is not invoiced.';
  end if;
  return public._create_platform_invoice(p_school_id, p_period_start, p_period_end, 'issued', 'manual', null, null, p_due_days, null, null);
end;
$$;

-- ============================================================
-- 5. Automated billing planner skips complimentary schools
-- ============================================================
create or replace function public.plan_platform_billing_cycle(p_as_of date default null)
returns table (
  school_id uuid, school_name text, term_id uuid, period_start date, period_end date, label text,
  students integer, unit_price_kes numeric, total_kes numeric, decision text, reason text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.platform_billing_settings%rowtype;
  v_asof date := coalesce(p_as_of, (now() at time zone 'Africa/Nairobi')::date);
  r record;
  v_q jsonb;
  v_reason text;
  v_seen jsonb := '{}'::jsonb;
  v_last_end date;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  select * into v_set from public.platform_billing_settings where id;

  -- Candidates: paying (active subscription) schools, terms that have ENDED (by end_date, never by
  -- the user-editable term.status), within the look-back window and on/after the effective date.
  for r in
    select sc.id as sid, sc.name as sname, t.id as tid, t.start_date, t.end_date, t.term_number,
           sub.current_period_start, sub.plan_id, sub.price_override_kes, sub.complimentary, pl.billing_period
    from public.schools sc
    join public.school_subscriptions sub on sub.school_id = sc.id
    left join public.subscription_plans pl on pl.id = sub.plan_id
    join public.terms t on t.school_id = sc.id
    where sc.status = 'active' and sub.status = 'active'
      and t.end_date <= v_asof
      and t.end_date >= v_asof - v_set.auto_lookback_days
      and (v_set.auto_effective_from is null or t.end_date >= v_set.auto_effective_from)
    order by sc.name, t.start_date, t.id
  loop
    school_id := r.sid; school_name := r.sname; term_id := r.tid; period_start := r.start_date; period_end := r.end_date;
    label := 'Term ' || r.term_number || ' ' || extract(year from r.end_date)::int;
    students := null; unit_price_kes := null; total_kes := null; decision := 'skip'; reason := null;

    if r.complimentary then
      reason := 'complimentary';
    elsif exists (select 1 from public.platform_invoices i where i.school_id = r.sid and i.term_id = r.tid and i.status <> 'cancelled') then
      reason := 'already_invoiced';
    elsif r.plan_id is null and r.price_override_kes is null then
      reason := 'no_plan_assigned';
    elsif r.billing_period is not null and r.billing_period <> 'termly' then
      reason := 'plan_not_termly (automation only supports termly billing)';
    elsif r.current_period_start is not null and r.current_period_start > r.end_date then
      reason := 'subscription_started_after_term_ended';
    elsif exists (select 1 from public.platform_invoices i where i.school_id = r.sid and i.status <> 'cancelled'
                  and i.period_start < r.end_date and i.period_end > r.start_date) then
      reason := 'overlaps_existing_invoice';
    elsif (v_seen ->> r.sid::text) is not null and (v_seen ->> r.sid::text)::date > r.start_date then
      reason := 'overlaps_earlier_term_in_this_run';
    else
      v_q := public._platform_invoice_quote(r.sid);
      students := (v_q->>'students')::int; unit_price_kes := (v_q->>'unit_price_kes')::numeric; total_kes := (v_q->>'total_kes')::numeric;
      if students = 0 then
        reason := 'no_billable_students';
      else
        decision := 'create';
        v_seen := v_seen || jsonb_build_object(r.sid::text, r.end_date::text);
      end if;
    end if;
    return next;
  end loop;
end;
$$;
