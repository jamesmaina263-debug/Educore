create table public.payroll_statutory_rates (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  nssf_lel numeric not null,
  nssf_uel numeric not null,
  nssf_rate numeric not null,
  shif_rate numeric not null,
  shif_min numeric not null default 0,
  ahl_rate numeric not null,
  paye_bands jsonb not null,
  personal_relief numeric not null,
  source_note text,
  created_at timestamptz not null default now()
);
comment on table public.payroll_statutory_rates is
  'Kenyan payroll statutory rates (NSSF/SHIF/AHL/PAYE), versioned by effective_from. A rate change is a new row, never an edit to application code. Platform-wide, not per-school.';

alter table public.payroll_statutory_rates enable row level security;

create policy payroll_statutory_rates_select on public.payroll_statutory_rates
  for select using (auth_school_id() is not null or auth_has_permission('payroll.read_any'));

create policy payroll_statutory_rates_write on public.payroll_statutory_rates
  for all using (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = auth.uid() and su.status = 'active' and r.name = 'super_admin')
  ) with check (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = auth.uid() and su.status = 'active' and r.name = 'super_admin')
  );

insert into public.payroll_statutory_rates
  (effective_from, nssf_lel, nssf_uel, nssf_rate, shif_rate, shif_min, ahl_rate, paye_bands, personal_relief, source_note)
values (
  '2026-02-01',
  9000, 108000, 0.06,
  0.0275, 300,
  0.015,
  '[{"upto":24000,"rate":0.10},{"upto":32333,"rate":0.25},{"upto":500000,"rate":0.30},{"upto":800000,"rate":0.325},{"upto":null,"rate":0.35}]'::jsonb,
  2400,
  'NSSF Tier I/II Year 4 (UEL 108,000, Feb 2026); SHIF 2.75% min 300; AHL 1.5% (deductible pre-PAYE per KRA Tax Laws Amendment Act 2024 notice); PAYE bands per Finance Act 2023; personal relief 2,400/mo. Verify with a Kenyan tax professional before relying on this for statutory filing.'
);

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  teacher_id uuid not null references public.school_users(id),
  period_year smallint not null,
  period_month smallint not null check (period_month between 1 and 12),
  statutory_rate_id uuid not null references public.payroll_statutory_rates(id),
  gross_salary numeric not null check (gross_salary >= 0),
  nssf_employee numeric not null check (nssf_employee >= 0),
  shif numeric not null check (shif >= 0),
  ahl numeric not null check (ahl >= 0),
  taxable_income numeric not null check (taxable_income >= 0),
  paye_gross numeric not null check (paye_gross >= 0),
  personal_relief_applied numeric not null check (personal_relief_applied >= 0),
  paye numeric not null check (paye >= 0),
  other_deductions numeric not null default 0 check (other_deductions >= 0),
  other_deductions_note text,
  net_pay numeric not null check (net_pay >= 0),
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  payslip_document_id uuid references public.documents(id),
  generated_by uuid references public.school_users(id),
  approved_by uuid references public.school_users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, teacher_id, period_year, period_month)
);
comment on table public.payroll_records is
  'One payslip per staff member per calendar month. Generated via generate_payroll_record() which snapshots the statutory rate in effect for that period (statutory_rate_id) so a later rate change never retroactively changes an already-generated payslip — same snapshot pattern as invoices.total_amount (Phase 2, blueprint Part D).';

alter table public.payroll_records enable row level security;

create policy payroll_records_select on public.payroll_records
  for select using (
    (school_id = auth_school_id() and auth_has_permission('payroll.read_any'))
    or exists (select 1 from school_users su where su.id = payroll_records.teacher_id and su.auth_user_id = (select auth.uid()))
  );

create policy payroll_records_insert on public.payroll_records
  for insert with check (school_id = auth_school_id() and auth_has_permission('payroll.write'));

create policy payroll_records_update on public.payroll_records
  for update using (school_id = auth_school_id() and auth_has_permission('payroll.write'))
  with check (school_id = auth_school_id() and auth_has_permission('payroll.write'));

revoke all on public.payroll_statutory_rates from public, anon;
revoke all on public.payroll_records from public, anon;
grant select on public.payroll_statutory_rates to authenticated;
grant select, insert, update on public.payroll_records to authenticated;
