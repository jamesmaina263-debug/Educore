-- ============================================================================
-- Phase 15 (3/6): Payroll — Salary Structures, Allowances, Deductions (Brief 4.8)
-- payroll_records/payroll_statutory_rates already handle Kenyan statutory
-- compliance correctly (REUSE, untouched) and generate_payroll_record/
-- approve_payroll_record/mark_payroll_paid RPCs stay exactly as they are.
-- This adds the missing "salary structures, allowances, deductions" input
-- layer feeding INTO that existing pipeline as better-computed defaults,
-- rather than replacing or duplicating any of it.
-- ============================================================================

create table public.staff_salary_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  staff_id uuid not null references public.school_users(id),
  basic_salary numeric(12,2) not null,
  effective_from date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one active structure per staff member at a time.
create unique index staff_salary_structures_one_active_idx
  on public.staff_salary_structures(staff_id) where active;

create index staff_salary_structures_school_idx on public.staff_salary_structures(school_id);

alter table public.staff_salary_structures enable row level security;

create policy staff_salary_structures_select on public.staff_salary_structures for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('payroll.read_any')
        or staff_id = auth_school_user_id()
      )
    )
  );

create policy staff_salary_structures_write on public.staff_salary_structures for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')));

create trigger trg_audit_staff_salary_structures
  after insert or update or delete on public.staff_salary_structures
  for each row execute function public.audit_row_change();

create table public.salary_structure_allowances (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.staff_salary_structures(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  name text not null,
  amount numeric(12,2) not null check (amount >= 0)
);

alter table public.salary_structure_allowances enable row level security;

create policy salary_structure_allowances_select on public.salary_structure_allowances for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('payroll.read_any')
        or exists (select 1 from public.staff_salary_structures s where s.id = salary_structure_allowances.structure_id and s.staff_id = auth_school_user_id())
      )
    )
  );

create policy salary_structure_allowances_write on public.salary_structure_allowances for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')));

create table public.salary_structure_deductions (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.staff_salary_structures(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  name text not null,
  amount numeric(12,2) not null check (amount >= 0)
);

alter table public.salary_structure_deductions enable row level security;

create policy salary_structure_deductions_select on public.salary_structure_deductions for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('payroll.read_any')
        or exists (select 1 from public.staff_salary_structures s where s.id = salary_structure_deductions.structure_id and s.staff_id = auth_school_user_id())
      )
    )
  );

create policy salary_structure_deductions_write on public.salary_structure_deductions for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('payroll.write')));
