-- WP 6.1: Cashbook, read-only first (additive, dark behind feature.finance.cashbook).
--
-- A cashbook is the chronological record of money received and money paid out, with a running
-- balance. This layer only READS existing records and never changes how payments, reversals or
-- expenses are stored:
--   money in   = payments that were actually received (status recorded, confirmed, reversed or
--                unallocated; 'pending' STK requests are not money yet), dated by recorded_at;
--   money out  = payment reversals (dated by created_at, account = the original payment's method)
--                and APPROVED expenses (dated by approved_at, the same basis as the vote head ledger).
-- Known limit, shown to the user on the page: an expense row has no payment method and no paid date,
-- so approved expenses are booked to the account 'unspecified' on their approval date. Approved is
-- not necessarily paid.
-- Dates are Kenya calendar days (Africa/Nairobi).
-- Every function returns nothing when the flag is off or the caller lacks finance.read (fails closed).

-- 1. Flag catalog entry (visible to platform admins, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.cashbook',
       'Cashbook (read-only)',
       'Shows money received and money paid out in date order with a running balance, built from existing payments, reversals and approved expenses. Read-only. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.cashbook'
);

-- 2. Internal line builder. Not callable by clients: only the functions below use it.
create or replace function public.cashbook_lines_internal(p_school uuid)
returns table (entry_at timestamptz, entry_date date, kind text, account text, reference text,
               description text, money_in numeric, money_out numeric, source_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.recorded_at, (p.recorded_at at time zone 'Africa/Nairobi')::date, 'receipt'::text, p.method,
         p.reference, coalesce(nullif(btrim(p.purpose), ''), 'Payment'), p.amount, 0::numeric, p.id
    from public.payments p
   where p.school_id = p_school and p.status in ('recorded', 'confirmed', 'reversed', 'unallocated')
  union all
  select r.created_at, (r.created_at at time zone 'Africa/Nairobi')::date, 'reversal'::text, p.method,
         p.reference, 'Payment reversal', 0::numeric, r.amount, r.id
    from public.payment_reversals r
    join public.payments p on p.id = r.payment_id
   where p.school_id = p_school
  union all
  select coalesce(e.approved_at, e.created_at),
         (coalesce(e.approved_at, e.created_at) at time zone 'Africa/Nairobi')::date, 'expense'::text,
         'unspecified'::text, e.vendor, e.category, 0::numeric, e.amount, e.id
    from public.expenses e
   where e.school_id = p_school and e.status = 'approved';
$$;
revoke all on function public.cashbook_lines_internal(uuid) from public, anon, authenticated;

-- 3. Entries in date order for a window (inclusive Kenya dates). At most p_limit rows (cap 5000);
--    cashbook_summary tells the caller how many entries the window really holds.
create or replace function public.cashbook_entries(p_from date default null, p_to date default null, p_limit integer default 2000)
returns table (entry_date date, entry_at timestamptz, kind text, account text, reference text,
               description text, money_in numeric, money_out numeric, source_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('finance.read')
     or not public.school_has_feature_flag(v_school, 'feature.finance.cashbook') then
    return;
  end if;
  return query
  select l.entry_date, l.entry_at, l.kind, l.account, l.reference, l.description, l.money_in, l.money_out, l.source_id
    from public.cashbook_lines_internal(v_school) l
   where (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to)
   order by l.entry_at, l.kind, l.source_id
   limit least(greatest(coalesce(p_limit, 2000), 1), 5000);
end;
$$;
revoke all on function public.cashbook_entries(date, date, integer) from public, anon;
grant execute on function public.cashbook_entries(date, date, integer) to authenticated;

-- 4. Per-account opening balance, movement and closing balance for a window.
--    Opening = everything dated before p_from (zero when p_from is null).
create or replace function public.cashbook_summary(p_from date default null, p_to date default null)
returns table (account text, opening numeric, money_in numeric, money_out numeric, closing numeric, entries bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('finance.read')
     or not public.school_has_feature_flag(v_school, 'feature.finance.cashbook') then
    return;
  end if;
  return query
  select l.account,
         coalesce(sum(l.money_in - l.money_out) filter (where p_from is not null and l.entry_date < p_from), 0)::numeric,
         coalesce(sum(l.money_in) filter (where (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to)), 0)::numeric,
         coalesce(sum(l.money_out) filter (where (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to)), 0)::numeric,
         coalesce(sum(l.money_in - l.money_out) filter (where p_to is null or l.entry_date <= p_to), 0)::numeric,
         count(*) filter (where (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to))
    from public.cashbook_lines_internal(v_school) l
   group by l.account
   order by l.account;
end;
$$;
revoke all on function public.cashbook_summary(date, date) from public, anon;
grant execute on function public.cashbook_summary(date, date) to authenticated;

-- 5. All-time reconciliation against the raw tables (a second, independent calculation).
--    Differences must be zero: the cashbook adds up to payments received, reversals and approved
--    expenses to the shilling.
create or replace function public.cashbook_reconciliation()
returns table (payments_received numeric, cashbook_receipts numeric, receipts_difference numeric,
               reversals_total numeric, cashbook_reversals numeric, reversals_difference numeric,
               approved_expenses numeric, cashbook_expenses numeric, expenses_difference numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_pay numeric; v_rev numeric; v_exp numeric;
  c_pay numeric; c_rev numeric; c_exp numeric;
begin
  if v_school is null or not auth_has_permission('finance.read')
     or not public.school_has_feature_flag(v_school, 'feature.finance.cashbook') then
    return;
  end if;
  select coalesce(sum(amount), 0) into v_pay from public.payments
   where school_id = v_school and status in ('recorded', 'confirmed', 'reversed', 'unallocated');
  select coalesce(sum(r.amount), 0) into v_rev from public.payment_reversals r
    join public.payments p on p.id = r.payment_id where p.school_id = v_school;
  select coalesce(sum(amount), 0) into v_exp from public.expenses
   where school_id = v_school and status = 'approved';
  select coalesce(sum(money_in) filter (where kind = 'receipt'), 0),
         coalesce(sum(money_out) filter (where kind = 'reversal'), 0),
         coalesce(sum(money_out) filter (where kind = 'expense'), 0)
    into c_pay, c_rev, c_exp
    from public.cashbook_lines_internal(v_school);
  return query select v_pay, c_pay, v_pay - c_pay, v_rev, c_rev, v_rev - c_rev, v_exp, c_exp, v_exp - c_exp;
end;
$$;
revoke all on function public.cashbook_reconciliation() from public, anon;
grant execute on function public.cashbook_reconciliation() to authenticated;
