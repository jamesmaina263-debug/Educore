-- Phase 7.2 (1/4): staff loan and salary-advance ledger, database core (option B of docs/designs/wp-7-2-staff-advances.md).
-- Additive only; ships dark. NOTHING EXISTING IS EDITED, and this migration WRITES NOTHING to payroll: it keeps the
-- ledger and exposes a read-only 'what is due' calculation that a payroll officer enters by hand, exactly as they
-- enter any other deduction today. Automatic placement on payroll is a separate, held migration.
--
-- Scope: this records what the school has lent to a member of staff and what has been repaid, and works out the
-- instalment that is lawfully due for a payroll record. It moves no money: it does not pay out the loan and takes no
-- payment. A repayment is recorded by hand (a payroll deduction the officer entered, or cash handed back).
--
-- Employment Act 2007, section 19 (Kenya) is built into the calculation, not left to the user:
--   * a loan can only be recovered from wages under a written agreement, so a loan cannot become active without
--     the date of that agreement;
--   * total deductions at any one time may not exceed two-thirds of wages (s.19(3));
--   * a loan repayment may not exceed 50% of the wages left after all other deductions (s.19(1)(h)).
--   "Wages" is taken as the record's gross salary. The caps are computed from the saved draft's real statutory
--   figures, never from a second copy of the tax maths.
--
-- Safety properties:
--   * Separation of duties: payroll.write creates; payroll.approve activates (needs the agreement date) and
--     cannot be the creator or the borrower.
--   * The ledger is append-only and can never repay more than was lent (enforced by a trigger under a row lock).
--   * Visibility: payroll.read_any, or the borrower themself. Writes only through the SECURITY DEFINER functions.
-- Rollback: switch the flag off. To remove: drop the 2 tables, the view and the functions.

insert into public.platform_feature_flags (key, label, description)
select 'feature.hr.staff_loans',
       'Staff loans and advances',
       'Ledger of staff loans and salary advances with repayments deducted through payroll, within the Employment Act limits. Records only; pays out nothing. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.hr.staff_loans');

-- 1. Tables.
create table if not exists public.staff_loans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.school_users(id) on delete cascade,
  kind text not null check (kind in ('loan', 'advance')),
  principal numeric(12, 2) not null check (principal > 0 and principal <= 5000000),
  installment numeric(12, 2) not null check (installment > 0),
  first_year smallint not null check (first_year between 2000 and 2100),
  first_month smallint not null check (first_month between 1 and 12),
  reason text check (reason is null or char_length(reason) <= 200),
  status text not null default 'pending' check (status in ('pending', 'active', 'paid_off', 'cancelled')),
  agreement_on date,
  created_by uuid references public.school_users(id) on delete set null,
  approved_by uuid references public.school_users(id) on delete set null,
  approved_at timestamptz,
  closed_reason text check (closed_reason is null or char_length(closed_reason) <= 200),
  closed_by uuid references public.school_users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_loans_installment_le_principal check (installment <= principal),
  constraint staff_loans_active_needs_approval check (status not in ('active', 'paid_off') or (approved_by is not null and agreement_on is not null)),
  constraint staff_loans_cancelled_needs_reason check (status <> 'cancelled' or closed_reason is not null)
);
comment on table public.staff_loans is 'A loan or salary advance to a member of staff. Never deleted. Written only by the staff loan functions.';
create index if not exists staff_loans_school_staff on public.staff_loans (school_id, staff_id, status);

create table if not exists public.staff_loan_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  loan_id uuid not null references public.staff_loans(id) on delete cascade,
  kind text not null check (kind in ('repayment', 'manual_repayment', 'write_off')),
  amount numeric(12, 2) not null check (amount > 0),
  period_year smallint,
  period_month smallint,
  payroll_record_id uuid references public.payroll_records(id),
  note text check (note is null or char_length(note) <= 200),
  client_ref text check (client_ref is null or char_length(client_ref) between 1 and 64),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_loan_entries_shape check (
    (kind = 'repayment' and payroll_record_id is not null and period_year is not null and period_month is not null)
    or (kind in ('manual_repayment', 'write_off') and payroll_record_id is null)
  )
);
comment on table public.staff_loan_entries is 'Append-only repayment ledger. Balance = principal minus the sum of these.';
create index if not exists staff_loan_entries_loan on public.staff_loan_entries (loan_id, created_at);
create unique index if not exists staff_loan_entries_payroll_uniq on public.staff_loan_entries (loan_id, payroll_record_id) where payroll_record_id is not null;
create unique index if not exists staff_loan_entries_ref_uniq on public.staff_loan_entries (school_id, client_ref) where client_ref is not null;

-- 2. History cannot be rewritten: entries refuse UPDATE and DELETE. The only bypass is the existing owner-level
--    school purge / trial reset switch.
create or replace function public.staff_loan_block_change()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator', 'service_role')
     and coalesce(current_setting('educore.school_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception 'staff loan history is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$function$;
revoke all on function public.staff_loan_block_change() from public, anon, authenticated;

drop trigger if exists trg_staff_loan_entries_append_only on public.staff_loan_entries;
create trigger trg_staff_loan_entries_append_only before update or delete on public.staff_loan_entries
  for each row execute function public.staff_loan_block_change();

-- 3. A loan can never be repaid beyond what was lent, whichever path writes the entry; reaching zero closes it.
create or replace function public.staff_loan_entry_before()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_loan record;
  v_repaid numeric(12, 2);
begin
  select id, principal, status into v_loan from public.staff_loans where id = new.loan_id for update;
  if v_loan.status <> 'active' then
    raise exception 'This loan is not active, so no repayment can be recorded against it.' using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0) into v_repaid from public.staff_loan_entries where loan_id = new.loan_id;
  if v_repaid + new.amount > v_loan.principal then
    raise exception 'That is more than is still owed (owed: %).', v_loan.principal - v_repaid using errcode = '22023';
  end if;
  return new;
end;
$function$;
revoke all on function public.staff_loan_entry_before() from public, anon, authenticated;

create or replace function public.staff_loan_entry_after()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select principal - coalesce((select sum(amount) from public.staff_loan_entries where loan_id = new.loan_id), 0)
        from public.staff_loans where id = new.loan_id) = 0 then
    update public.staff_loans set status = 'paid_off', updated_at = now() where id = new.loan_id and status = 'active';
  end if;
  return new;
end;
$function$;
revoke all on function public.staff_loan_entry_after() from public, anon, authenticated;

drop trigger if exists trg_staff_loan_entries_before on public.staff_loan_entries;
create trigger trg_staff_loan_entries_before before insert on public.staff_loan_entries
  for each row execute function public.staff_loan_entry_before();
drop trigger if exists trg_staff_loan_entries_after on public.staff_loan_entries;
create trigger trg_staff_loan_entries_after after insert on public.staff_loan_entries
  for each row execute function public.staff_loan_entry_after();

drop trigger if exists trg_audit_staff_loans on public.staff_loans;
create trigger trg_audit_staff_loans after insert or update or delete on public.staff_loans
  for each row execute function public.audit_row_change();

-- 4. Row-level security: select only. payroll.read_any sees the school's loans; a borrower sees their own.
create or replace function public.staff_loans_can_read(p_school uuid, p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_school = auth_school_id()
    and public.my_school_has_feature_flag('feature.hr.staff_loans')
    and (
      auth_has_permission('payroll.read_any')
      or exists (select 1 from public.school_users su where su.id = p_staff and su.auth_user_id = auth.uid() and su.status = 'active')
    );
$$;
revoke all on function public.staff_loans_can_read(uuid, uuid) from public, anon;
grant execute on function public.staff_loans_can_read(uuid, uuid) to authenticated;

alter table public.staff_loans enable row level security;
alter table public.staff_loan_entries enable row level security;

drop policy if exists staff_loans_select on public.staff_loans;
create policy staff_loans_select on public.staff_loans for select using (public.staff_loans_can_read(school_id, staff_id));
drop policy if exists staff_loan_entries_select on public.staff_loan_entries;
create policy staff_loan_entries_select on public.staff_loan_entries for select
  using (exists (select 1 from public.staff_loans l where l.id = staff_loan_entries.loan_id));

create or replace view public.staff_loan_balances with (security_invoker = true) as
  select l.id as loan_id, l.school_id, l.staff_id, l.principal,
         coalesce(sum(e.amount), 0)::numeric(12, 2) as repaid,
         (l.principal - coalesce(sum(e.amount), 0))::numeric(12, 2) as balance
    from public.staff_loans l
    left join public.staff_loan_entries e on e.loan_id = l.id
   group by l.id;
grant select on public.staff_loan_balances to authenticated;

-- 5. Shared guard and actor lookup.
create or replace function public.staff_loans_guard(p_permission text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission(p_permission) then
    raise exception 'Not authorized for this staff loan action.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.hr.staff_loans') then
    raise exception 'Staff loans are not enabled for this school.' using errcode = '55000';
  end if;
  return v_school;
end;
$$;
revoke all on function public.staff_loans_guard(text) from public, anon, authenticated;

create or replace function public.staff_loans_actor(p_school uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.school_users where auth_user_id = auth.uid() and school_id = p_school and status = 'active' limit 1;
$$;
revoke all on function public.staff_loans_actor(uuid) from public, anon, authenticated;

-- 6. Create (payroll.write). The loan starts as pending and does nothing until approved.
create or replace function public.create_staff_loan(
  p_staff_id uuid, p_kind text, p_principal numeric, p_installment numeric,
  p_first_year integer, p_first_month integer, p_reason text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.write');
  v_role text;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('loan', 'advance')
     or p_principal is null or p_principal <= 0 or p_principal > 5000000 or p_principal <> round(p_principal, 2)
     or p_installment is null or p_installment <= 0 or p_installment > p_principal or p_installment <> round(p_installment, 2)
     or p_first_year is null or p_first_year not between 2000 and 2100
     or p_first_month is null or p_first_month not between 1 and 12
     or (p_reason is not null and char_length(p_reason) > 200) then
    raise exception 'Invalid loan details.' using errcode = '22023';
  end if;
  select r.name into v_role from public.school_users su join public.roles r on r.id = su.role_id
   where su.id = p_staff_id and su.school_id = v_school and su.status = 'active';
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  if v_role in ('parent', 'student') then
    raise exception 'Loans can only be made to staff.' using errcode = '22023';
  end if;
  insert into public.staff_loans (school_id, staff_id, kind, principal, installment, first_year, first_month, reason, created_by)
  values (v_school, p_staff_id, p_kind, p_principal, p_installment, p_first_year, p_first_month, nullif(btrim(p_reason), ''),
          public.staff_loans_actor(v_school))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_staff_loan(uuid, text, numeric, numeric, integer, integer, text) from public, anon;
grant execute on function public.create_staff_loan(uuid, text, numeric, numeric, integer, integer, text) to authenticated;

-- 7. Approve (payroll.approve). Needs the date of the written agreement. Not the creator, not the borrower.
create or replace function public.approve_staff_loan(p_loan_id uuid, p_agreement_on date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.approve');
  v_actor uuid := public.staff_loans_actor(public.staff_loans_guard('payroll.approve'));
  v_loan record;
begin
  select id, staff_id, created_by, status into v_loan from public.staff_loans where id = p_loan_id and school_id = v_school for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;
  if v_loan.status <> 'pending' then
    raise exception 'Only a pending loan can be approved.' using errcode = '22023';
  end if;
  if v_actor is null or v_actor = v_loan.created_by or v_actor = v_loan.staff_id then
    raise exception 'A loan must be approved by someone other than the person who created it and the person borrowing.' using errcode = '42501';
  end if;
  if p_agreement_on is null or p_agreement_on > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Enter the date of the signed written agreement (it cannot be in the future).' using errcode = '22023';
  end if;
  update public.staff_loans
     set status = 'active', agreement_on = p_agreement_on, approved_by = v_actor, approved_at = now(), updated_at = now()
   where id = p_loan_id;
end;
$$;
revoke all on function public.approve_staff_loan(uuid, date) from public, anon;
grant execute on function public.approve_staff_loan(uuid, date) to authenticated;

-- 8. Cancel (payroll.write): only while nothing has been deducted, planned or repaid.
create or replace function public.cancel_staff_loan(p_loan_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.write');
  v_status text;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'Give a reason (3 to 200 characters).' using errcode = '22023';
  end if;
  select status into v_status from public.staff_loans where id = p_loan_id and school_id = v_school for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;
  if v_status not in ('pending', 'active') then
    raise exception 'This loan is already closed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.staff_loan_entries where loan_id = p_loan_id) then
    raise exception 'This loan already has repayments. Use a write-off for what is left.' using errcode = '22023';
  end if;
  update public.staff_loans
     set status = 'cancelled', closed_reason = btrim(p_reason), closed_by = public.staff_loans_actor(v_school), closed_at = now(), updated_at = now()
   where id = p_loan_id;
end;
$$;
revoke all on function public.cancel_staff_loan(uuid, text) from public, anon;
grant execute on function public.cancel_staff_loan(uuid, text) to authenticated;

-- 9. Write off what is left (payroll.approve). Never the borrower. Recorded in the ledger, never deleted.
create or replace function public.write_off_staff_loan(p_loan_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.approve');
  v_actor uuid := public.staff_loans_actor(public.staff_loans_guard('payroll.approve'));
  v_loan record;
  v_left numeric(12, 2);
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'Give a reason (3 to 200 characters).' using errcode = '22023';
  end if;
  select id, staff_id, principal, status into v_loan from public.staff_loans where id = p_loan_id and school_id = v_school for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'Only an active loan can be written off.' using errcode = '22023';
  end if;
  if v_actor is null or v_actor = v_loan.staff_id then
    raise exception 'A loan cannot be written off by the person who owes it.' using errcode = '42501';
  end if;
  v_left := v_loan.principal - coalesce((select sum(amount) from public.staff_loan_entries where loan_id = p_loan_id), 0);
  if v_left <= 0 then
    raise exception 'Nothing is left to write off.' using errcode = '22023';
  end if;
  insert into public.staff_loan_entries (school_id, loan_id, kind, amount, note, created_by)
  values (v_school, p_loan_id, 'write_off', v_left, btrim(p_reason), v_actor);
  return v_left;
end;
$$;
revoke all on function public.write_off_staff_loan(uuid, text) from public, anon;
grant execute on function public.write_off_staff_loan(uuid, text) to authenticated;

-- 10. Record cash the staff member handed back outside payroll (payroll.write). Idempotent on p_client_ref.
create or replace function public.record_staff_loan_repayment(p_loan_id uuid, p_amount numeric, p_note text, p_client_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.write');
  v_principal numeric(12, 2);
  v_existing record;
  v_balance numeric(12, 2);
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_client_ref is null or char_length(p_client_ref) not between 1 and 64
     or (p_note is not null and char_length(p_note) > 200) then
    raise exception 'Invalid repayment.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_school::text || ':slr:' || p_client_ref, 0));
  select loan_id, amount into v_existing from public.staff_loan_entries where school_id = v_school and client_ref = p_client_ref;
  if found then
    return jsonb_build_object('duplicate', true, 'balance',
      (select balance from public.staff_loan_balances where loan_id = v_existing.loan_id));
  end if;
  select principal into v_principal from public.staff_loans where id = p_loan_id and school_id = v_school;
  if not found then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;
  insert into public.staff_loan_entries (school_id, loan_id, kind, amount, note, client_ref, created_by)
  values (v_school, p_loan_id, 'manual_repayment', p_amount, nullif(btrim(p_note), ''), p_client_ref, public.staff_loans_actor(v_school));
  select balance into v_balance from public.staff_loan_balances where loan_id = p_loan_id;
  return jsonb_build_object('duplicate', false, 'balance', v_balance);
end;
$$;
revoke all on function public.record_staff_loan_repayment(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_staff_loan_repayment(uuid, numeric, text, text) to authenticated;

-- 11. READ-ONLY: what is lawfully due on a payroll record. Writes nothing. A payroll officer enters this by hand as a
--     deduction, exactly as they enter any other. p_already_applied is the amount of loan lines already counted inside
--     the record's other_deductions (zero when nothing was placed automatically).
create or replace function public.staff_loan_due_for_record(p_record_id uuid, p_already_applied numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.write');
  r record;
  v_other numeric;
  v_statutory numeric;
  v_wages numeric;
  v_before numeric;
  v_cap numeric;
  v_left numeric;
  v_total numeric(12, 2) := 0;
  v_amount numeric(12, 2);
  v_lines jsonb := '[]'::jsonb;
  v_capped boolean := false;
  l record;
begin
  if p_already_applied is null or p_already_applied < 0 then
    raise exception 'Invalid amount already applied.' using errcode = '22023';
  end if;
  select * into r from public.payroll_records where id = p_record_id and school_id = v_school;
  if not found then
    raise exception 'Payroll record not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'Loan deductions can only be worked out for a draft payroll record.' using errcode = '22023';
  end if;

  -- the legal limits, from this record's own saved figures (never a second copy of the tax maths)
  v_wages := r.gross_salary;
  v_statutory := r.nssf_employee + r.shif + r.ahl + r.paye;
  v_other := r.other_deductions - p_already_applied;
  v_before := v_wages - v_statutory - v_other;
  v_cap := greatest(least((v_wages * 2 / 3) - v_statutory - v_other, v_before * 0.5), 0);
  v_cap := trunc(v_cap * 100) / 100;
  v_left := v_cap;

  for l in
    select sl.id, sl.kind, sl.installment, b.balance
      from public.staff_loans sl
      join public.staff_loan_balances b on b.loan_id = sl.id
     where sl.school_id = v_school and sl.staff_id = r.teacher_id and sl.status = 'active' and b.balance > 0
       and (sl.first_year * 12 + sl.first_month) <= (r.period_year * 12 + r.period_month)
     order by sl.created_at, sl.id
  loop
    v_amount := least(l.installment, l.balance);
    if v_amount > v_left then
      v_amount := trunc(v_left * 100) / 100;
      v_capped := true;
    end if;
    if v_amount >= 0.01 then
      v_lines := v_lines || jsonb_build_object(
        'loan_id', l.id, 'kind', l.kind, 'amount', v_amount,
        'name', case l.kind when 'advance' then 'Salary advance recovery' else 'Staff loan repayment' end);
      v_total := v_total + v_amount;
      v_left := v_left - v_amount;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'lines', v_lines, 'capped', v_capped, 'cap', v_cap);
end;
$$;
revoke all on function public.staff_loan_due_for_record(uuid, numeric) from public, anon;
grant execute on function public.staff_loan_due_for_record(uuid, numeric) to authenticated;
