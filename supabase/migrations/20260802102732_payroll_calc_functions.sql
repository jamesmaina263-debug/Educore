create or replace function public.compute_paye(p_taxable numeric, p_bands jsonb, p_personal_relief numeric)
returns table(paye_gross numeric, personal_relief numeric, paye numeric)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  band record;
  prev numeric := 0;
  tax numeric := 0;
begin
  for band in select * from jsonb_to_recordset(p_bands) as x(upto numeric, rate numeric) loop
    if band.upto is null then
      tax := tax + greatest(p_taxable - prev, 0) * band.rate;
    else
      tax := tax + greatest(least(p_taxable, band.upto) - prev, 0) * band.rate;
      prev := band.upto;
    end if;
  end loop;
  return query select tax, p_personal_relief, greatest(tax - p_personal_relief, 0);
end;
$$;

create or replace function public.generate_payroll_record(
  p_teacher_id uuid,
  p_period_year smallint,
  p_period_month smallint,
  p_gross_salary numeric,
  p_other_deductions numeric default 0,
  p_other_deductions_note text default null
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
    other_deductions, other_deductions_note, net_pay,
    status, generated_by
  ) values (
    v_school_id, p_teacher_id, p_period_year, p_period_month, v_rate.id,
    p_gross_salary, v_nssf, v_shif, v_ahl, v_taxable,
    v_paye_calc.paye_gross, v_paye_calc.personal_relief, v_paye_calc.paye,
    p_other_deductions, p_other_deductions_note, v_net,
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

create or replace function public.approve_payroll_record(p_id uuid)
returns public.payroll_records
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_approver uuid;
  v_result public.payroll_records;
begin
  if not auth_has_permission('payroll.approve') then
    raise exception 'insufficient permissions: payroll.approve required';
  end if;

  select su.id into v_approver from school_users su where su.auth_user_id = auth.uid();

  update public.payroll_records
  set status = 'approved', approved_by = v_approver, approved_at = now(), updated_at = now()
  where id = p_id and school_id = auth_school_id() and status = 'draft'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'payroll record not found, not in this school, or not in draft status';
  end if;

  return v_result;
end;
$$;

create or replace function public.mark_payroll_paid(p_id uuid)
returns public.payroll_records
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result public.payroll_records;
begin
  if not auth_has_permission('payroll.write') then
    raise exception 'insufficient permissions: payroll.write required';
  end if;

  update public.payroll_records
  set status = 'paid', paid_at = now(), updated_at = now()
  where id = p_id and school_id = auth_school_id() and status = 'approved'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'payroll record not found, not in this school, or not approved yet';
  end if;

  return v_result;
end;
$$;

revoke all on function public.generate_payroll_record from public, anon;
revoke all on function public.approve_payroll_record from public, anon;
revoke all on function public.mark_payroll_paid from public, anon;
revoke all on function public.compute_paye from public, anon;
grant execute on function public.generate_payroll_record to authenticated;
grant execute on function public.approve_payroll_record to authenticated;
grant execute on function public.mark_payroll_paid to authenticated;
