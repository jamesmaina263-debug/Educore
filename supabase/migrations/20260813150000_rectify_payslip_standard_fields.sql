-- Rectify item 1 (Payroll): the payslip must include the standard fields on a typical Kenyan
-- payslip -- employer KRA PIN, employee KRA PIN/NSSF/SHIF numbers and staff number, and an
-- itemized breakdown of every named allowance/deduction (not just a single lump total).
--
-- staff_salary_structures / salary_structure_allowances / salary_structure_deductions
-- (Phase 15) already let someone set up named allowances/deductions -- but
-- generate_payroll_record() only ever received a single combined gross_salary number and a
-- single other_deductions total, so the per-name breakdown was lost the moment payroll was
-- generated. This adds two nullable jsonb snapshot columns so a payslip generated this month
-- keeps its own itemized breakdown even if the staff member's salary structure changes next
-- month -- same "snapshot at generation time" principle Finance already uses for invoices.
--
-- The statutory calculation itself (NSSF/SHIF/AHL/PAYE math) is untouched -- these are two new
-- optional parameters on top of the existing function, not a rewrite of it.

alter table public.payroll_records
  add column allowances_breakdown jsonb,
  add column deductions_breakdown jsonb;

comment on column public.payroll_records.allowances_breakdown is
  'Snapshot of named allowances (e.g. [{"name":"House Allowance","amount":5000}]) at the moment this payslip was generated, from that staff member''s salary structure at the time. Null for payslips generated before this column existed, or where gross_salary was entered as a single number with no structure behind it.';
comment on column public.payroll_records.deductions_breakdown is
  'Snapshot of named non-statutory deductions at generation time, same shape as allowances_breakdown. The existing other_deductions/other_deductions_note columns are kept as the authoritative total + a plain-text summary; this is the itemized form for payslip rendering.';

alter table public.schools add column kra_pin text;
comment on column public.schools.kra_pin is 'Employer KRA PIN, printed on payslips. Not the same as any individual staff member''s own KRA PIN.';

alter table public.school_users add column kra_pin text;
alter table public.school_users add column nssf_number text;
alter table public.school_users add column shif_number text;
alter table public.school_users add column staff_number text;
comment on column public.school_users.staff_number is 'Internal staff/payroll number, distinct from the auth account or school_users.id. Optional -- set by the school, not auto-generated.';

create or replace function public.generate_payroll_record(
  p_teacher_id uuid,
  p_period_year smallint,
  p_period_month smallint,
  p_gross_salary numeric,
  p_other_deductions numeric default 0,
  p_other_deductions_note text default null,
  p_allowances_breakdown jsonb default null,
  p_deductions_breakdown jsonb default null
)
returns public.payroll_records
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_rate public.payroll_statutory_rates%rowtype;
  v_nssf numeric;
  v_shif numeric;
  v_ahl numeric;
  v_taxable numeric;
  v_paye_calc record;
  v_net numeric;
  v_generated_by uuid;
  v_period_date date := make_date(p_period_year, p_period_month, 1);
  v_result public.payroll_records;
begin
  if not auth_has_permission('payroll.write') then
    raise exception 'insufficient permissions: payroll.write required';
  end if;

  select su.id into v_generated_by from school_users su where su.auth_user_id = auth.uid();

  select * into v_rate
  from public.payroll_statutory_rates
  where effective_from <= v_period_date
  order by effective_from desc
  limit 1;

  if v_rate.id is null then
    raise exception 'no statutory rate configured for period %', v_period_date;
  end if;

  v_nssf := least(p_gross_salary, v_rate.nssf_lel) * v_rate.nssf_rate
          + greatest(least(p_gross_salary, v_rate.nssf_uel) - v_rate.nssf_lel, 0) * v_rate.nssf_rate;
  v_shif := greatest(p_gross_salary * v_rate.shif_rate, v_rate.shif_min);
  v_ahl := p_gross_salary * v_rate.ahl_rate;
  v_taxable := greatest(p_gross_salary - v_nssf - v_shif - v_ahl, 0);

  select * into v_paye_calc from public.compute_paye(v_taxable, v_rate.paye_bands, v_rate.personal_relief);

  v_net := p_gross_salary - v_nssf - v_shif - v_ahl - v_paye_calc.paye - p_other_deductions;

  insert into public.payroll_records (
    school_id, teacher_id, period_year, period_month, statutory_rate_id,
    gross_salary, nssf_employee, shif, ahl, taxable_income,
    paye_gross, personal_relief_applied, paye,
    other_deductions, other_deductions_note, allowances_breakdown, deductions_breakdown, net_pay,
    status, generated_by
  ) values (
    v_school_id, p_teacher_id, p_period_year, p_period_month, v_rate.id,
    p_gross_salary, v_nssf, v_shif, v_ahl, v_taxable,
    v_paye_calc.paye_gross, v_paye_calc.personal_relief, v_paye_calc.paye,
    p_other_deductions, p_other_deductions_note, p_allowances_breakdown, p_deductions_breakdown, v_net,
    'draft', v_generated_by
  )
  on conflict (school_id, teacher_id, period_year, period_month)
  do update set
    statutory_rate_id = excluded.statutory_rate_id,
    gross_salary = excluded.gross_salary,
    nssf_employee = excluded.nssf_employee,
    shif = excluded.shif,
    ahl = excluded.ahl,
    taxable_income = excluded.taxable_income,
    paye_gross = excluded.paye_gross,
    personal_relief_applied = excluded.personal_relief_applied,
    paye = excluded.paye,
    other_deductions = excluded.other_deductions,
    other_deductions_note = excluded.other_deductions_note,
    allowances_breakdown = excluded.allowances_breakdown,
    deductions_breakdown = excluded.deductions_breakdown,
    net_pay = excluded.net_pay,
    generated_by = excluded.generated_by,
    updated_at = now()
  where public.payroll_records.status = 'draft'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'payroll record for this staff member/period is already approved or paid — cannot regenerate';
  end if;

  return v_result;
end;
$$;

-- The general school_users UPDATE policy requires staff.manage (or editing your own row) --
-- correct for most staff-profile edits, but Phase 14 gave a "Payroll Officer" role
-- payroll.write without staff.manage, and entering someone's statutory numbers is exactly
-- the kind of edit a Payroll Officer needs to make without also being handed broader staff-
-- management rights. A narrow SECURITY DEFINER RPC for just these four columns, gated on
-- payroll.write, is a smaller, safer change than widening the general school_users RLS
-- policy for every field on the table.
create or replace function public.update_staff_statutory_numbers(
  p_staff_id uuid,
  p_kra_pin text default null,
  p_nssf_number text default null,
  p_shif_number text default null,
  p_staff_number text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_has_permission('payroll.write') then
    raise exception 'insufficient permissions: payroll.write required';
  end if;

  update public.school_users
  set kra_pin = p_kra_pin,
      nssf_number = p_nssf_number,
      shif_number = p_shif_number,
      staff_number = p_staff_number,
      updated_at = now()
  where id = p_staff_id and school_id = auth_school_id();

  if not found then
    raise exception 'staff member not found in your school';
  end if;
end;
$$;
