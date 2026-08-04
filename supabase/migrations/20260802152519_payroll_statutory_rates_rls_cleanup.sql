drop policy payroll_statutory_rates_write on public.payroll_statutory_rates;

create policy payroll_statutory_rates_insert on public.payroll_statutory_rates
  for insert with check (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = (select auth.uid()) and su.status = 'active' and r.name = 'super_admin')
  );

create policy payroll_statutory_rates_update on public.payroll_statutory_rates
  for update using (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = (select auth.uid()) and su.status = 'active' and r.name = 'super_admin')
  ) with check (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = (select auth.uid()) and su.status = 'active' and r.name = 'super_admin')
  );

create policy payroll_statutory_rates_delete on public.payroll_statutory_rates
  for delete using (
    exists (select 1 from school_users su join roles r on r.id = su.role_id
            where su.auth_user_id = (select auth.uid()) and su.status = 'active' and r.name = 'super_admin')
  );
