-- Phase 7.2 (4/4): automatic placement of staff loan instalments on DRAFT payroll records. HELD FOR OWNER APPROVAL.
-- docs/designs/wp-7-2-staff-advances.md recommends option B (manual) for v1 and lists anything that writes to payroll
-- as a STOP item. This is the optional automation. It is additive, flag-gated (feature.hr.staff_loans, off) and has
-- no effect unless a school turns the flag on AND has an active loan, but it does two things option B does not:
--   (a) apply_staff_loans_to_draft() writes the instalment onto a DRAFT payroll_records row (other_deductions,
--       deductions_breakdown, net_pay moved by exactly the instalment), the same fields a payroll officer edits today;
--   (b) a new AFTER UPDATE trigger on payroll_records records the repayment in the same transaction in which a
--       record becomes 'paid'. For records with no placed loan deduction it does nothing.
-- If a loan deducted on a payslip is no longer active when the record is marked paid, the payment is BLOCKED with a
-- clear message rather than letting the payslip and the ledger disagree. A stale plan (the payslip no longer carries
-- the line) is released and records nothing.
-- Existing payroll functions are not edited; records without loan deductions are untouched.
-- Rollback: drop the trigger and the two functions; the ledger from migration 1 is unaffected.

create table if not exists public.staff_loan_deductions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  loan_id uuid not null references public.staff_loans(id) on delete cascade,
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'planned' check (status in ('planned', 'applied', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (loan_id, payroll_record_id)
);
comment on table public.staff_loan_deductions is 'A loan instalment placed on a draft payroll record. planned -> applied when the record is paid, or released if the payslip no longer carries it.';
create index if not exists staff_loan_deductions_record on public.staff_loan_deductions (payroll_record_id);


-- Settled deductions are permanent; only planned rows may change (and only by being settled). Same bypass as the ledger.
create or replace function public.staff_loan_deduction_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator', 'service_role')
     and coalesce(current_setting('educore.school_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if old.status = 'planned' then
    if tg_op = 'DELETE' then return old; end if;
    if new.loan_id = old.loan_id and new.payroll_record_id = old.payroll_record_id and new.amount = old.amount then
      return new;
    end if;
  end if;
  raise exception 'staff loan history is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$function$;
revoke all on function public.staff_loan_deduction_guard() from public, anon, authenticated;
drop trigger if exists trg_staff_loan_deductions_settled on public.staff_loan_deductions;
create trigger trg_staff_loan_deductions_settled before update or delete on public.staff_loan_deductions
  for each row execute function public.staff_loan_deduction_guard();

alter table public.staff_loan_deductions enable row level security;
drop policy if exists staff_loan_deductions_select on public.staff_loan_deductions;
create policy staff_loan_deductions_select on public.staff_loan_deductions for select
  using (exists (select 1 from public.staff_loans l where l.id = staff_loan_deductions.loan_id));

-- A loan with a payroll deduction placed on a draft cannot be cancelled or written off until it is taken off.
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
  if exists (select 1 from public.staff_loan_entries where loan_id = p_loan_id)
     or exists (select 1 from public.staff_loan_deductions where loan_id = p_loan_id) then
    raise exception 'This loan already has repayments or a payroll deduction. Use a write-off for what is left, or remove it from the draft payroll first.' using errcode = '22023';
  end if;
  update public.staff_loans
     set status = 'cancelled', closed_reason = btrim(p_reason), closed_by = public.staff_loans_actor(v_school), closed_at = now(), updated_at = now()
   where id = p_loan_id;
end;
$$;

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
  if exists (select 1 from public.staff_loan_deductions where loan_id = p_loan_id and status = 'planned') then
    raise exception 'Remove this loan from the draft payroll first.' using errcode = '22023';
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

-- Put the instalment(s) due on a DRAFT payroll record (payroll.write). Idempotent: it first takes off whatever it
-- added last time, then asks staff_loan_due_for_record() (which reads the record's own saved figures).
create or replace function public.apply_staff_loans_to_draft(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.staff_loans_guard('payroll.write');
  r record;
  v_old numeric(12, 2);
  v_due jsonb;
  v_total numeric(12, 2);
  v_breakdown jsonb;
  v_line jsonb;
begin
  select * into r from public.payroll_records where id = p_record_id and school_id = v_school for update;
  if not found then
    raise exception 'Payroll record not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'Loan deductions can only be placed on a draft payroll record.' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0) into v_old from public.staff_loan_deductions where payroll_record_id = p_record_id and status = 'planned';
  v_due := public.staff_loan_due_for_record(p_record_id, v_old);
  v_total := (v_due ->> 'total')::numeric;

  delete from public.staff_loan_deductions where payroll_record_id = p_record_id and status = 'planned';
  v_breakdown := coalesce((
    select jsonb_agg(x) from jsonb_array_elements(coalesce(r.deductions_breakdown, '[]'::jsonb)) x
     where coalesce(x ->> 'source', '') <> 'staff_loans'), '[]'::jsonb);

  for v_line in select * from jsonb_array_elements(v_due -> 'lines') loop
    insert into public.staff_loan_deductions (school_id, loan_id, payroll_record_id, amount)
    values (v_school, (v_line ->> 'loan_id')::uuid, p_record_id, (v_line ->> 'amount')::numeric);
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', v_line ->> 'name', 'amount', (v_line ->> 'amount')::numeric, 'loan_id', v_line ->> 'loan_id', 'source', 'staff_loans'));
  end loop;

  if v_total <> 0 or v_old <> 0 then
    update public.payroll_records
       set other_deductions = r.other_deductions - v_old + v_total,
           net_pay = r.net_pay + v_old - v_total,
           deductions_breakdown = case when jsonb_array_length(v_breakdown) = 0 then null else v_breakdown end,
           updated_at = now()
     where id = p_record_id;
  end if;
  return v_due;
end;
$$;
revoke all on function public.apply_staff_loans_to_draft(uuid) from public, anon;
grant execute on function public.apply_staff_loans_to_draft(uuid) to authenticated;

-- 12. When a payroll record becomes 'paid', settle its planned loan deductions in the same transaction. Does nothing
--     for a record with no planned loan deductions (every record in a school that does not use loans).
create or replace function public.staff_loan_payroll_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d record;
  v_loan record;
begin
  for d in
    select id, loan_id, amount from public.staff_loan_deductions
     where payroll_record_id = new.id and status = 'planned' order by id for update
  loop
    -- the payslip must still carry exactly this line, otherwise the plan is stale and is released
    if not exists (
      select 1 from jsonb_array_elements(coalesce(new.deductions_breakdown, '[]'::jsonb)) x
       where x ->> 'source' = 'staff_loans' and x ->> 'loan_id' = d.loan_id::text and (x ->> 'amount')::numeric = d.amount
    ) then
      update public.staff_loan_deductions set status = 'released', settled_at = now() where id = d.id;
      continue;
    end if;
    select id, staff_id, status into v_loan from public.staff_loans where id = d.loan_id for update;
    if v_loan.status <> 'active' or v_loan.staff_id <> new.teacher_id then
      raise exception 'Cannot mark this payroll as paid: a staff loan deducted on it is no longer active. Regenerate the payroll record and apply loans again.' using errcode = '22023';
    end if;
    insert into public.staff_loan_entries (school_id, loan_id, kind, amount, period_year, period_month, payroll_record_id, created_by)
    values (new.school_id, d.loan_id, 'repayment', d.amount, new.period_year, new.period_month, new.id, public.staff_loans_actor(new.school_id));
    update public.staff_loan_deductions set status = 'applied', settled_at = now() where id = d.id;
  end loop;
  return new;
end;
$function$;
revoke all on function public.staff_loan_payroll_paid() from public, anon, authenticated;

drop trigger if exists trg_staff_loan_payroll_paid on public.payroll_records;
create trigger trg_staff_loan_payroll_paid
  after update of status on public.payroll_records
  for each row when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function public.staff_loan_payroll_paid();
