-- Fix found immediately after applying Phase 15's Discipline & Welfare migration: while auditing
-- for the next module, discovered Phase 14 (RBAC/RLS Hardening) -- committed to this repo and
-- referenced as deployed in later commit messages -- was NEVER actually applied to the live
-- database. Confirmed via: none of its 5 new roles (welfare_officer, inventory_officer,
-- admissions_officer, academic_officer, payroll_officer) existed, auth_school_user_id() did not
-- exist, and `principal` was missing payroll.write specifically (a grant only Phase 14 adds).
--
-- Applied the full, unmodified content of
-- supabase/migrations/20260812041507_phase14_rbac_rls_hardening.sql directly against the live DB
-- in this session (that file itself needs no changes -- the bug was in deployment, not content).
--
-- This migration is the follow-up fix specific to Phase 15: welfare_officer now exists but,
-- since it was created before Discipline & Welfare's welfare.*/safeguarding.*/
-- discipline.cases.manage permission keys existed, was never granted any of them despite its own
-- role description being "Discipline & Welfare only". Also brings all six Phase 15 tables in line
-- with the auth_is_super_admin() bypass pattern Phase 14 established everywhere else.

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, perm.key, true
from public.roles r
cross join (values
  ('welfare.write'), ('welfare.read_any'),
  ('safeguarding.read'), ('safeguarding.write'),
  ('discipline.cases.manage')
) as perm(key)
where r.name = 'welfare_officer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key);

drop policy if exists disciplinary_action_types_select on public.disciplinary_action_types;
create policy disciplinary_action_types_select on public.disciplinary_action_types for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('discipline.read_any') or auth_has_permission('discipline.write'))));

drop policy if exists disciplinary_action_types_write on public.disciplinary_action_types;
create policy disciplinary_action_types_write on public.disciplinary_action_types for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists discipline_cases_select on public.discipline_cases;
create policy discipline_cases_select on public.discipline_cases for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('discipline.read_any')
        or opened_by = auth_school_user_id()
        or assigned_officer = auth_school_user_id()
      )
    )
  );

drop policy if exists discipline_cases_insert on public.discipline_cases;
create policy discipline_cases_insert on public.discipline_cases for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists discipline_cases_update on public.discipline_cases;
create policy discipline_cases_update on public.discipline_cases for update
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('discipline.cases.manage')
        or assigned_officer = auth_school_user_id()
      )
    )
  )
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists discipline_cases_delete on public.discipline_cases;
create policy discipline_cases_delete on public.discipline_cases for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists discipline_incident_staff_select on public.discipline_incident_staff;
create policy discipline_incident_staff_select on public.discipline_incident_staff for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('discipline.read_any') or auth_has_permission('discipline.write'))));

drop policy if exists discipline_incident_staff_write on public.discipline_incident_staff;
create policy discipline_incident_staff_write on public.discipline_incident_staff for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.write')));

drop policy if exists disciplinary_actions_select on public.disciplinary_actions;
create policy disciplinary_actions_select on public.disciplinary_actions for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('discipline.read_any')
        or issued_by = auth_school_user_id()
      )
    )
  );

drop policy if exists disciplinary_actions_insert on public.disciplinary_actions;
create policy disciplinary_actions_insert on public.disciplinary_actions for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.write')));

drop policy if exists disciplinary_actions_update on public.disciplinary_actions;
create policy disciplinary_actions_update on public.disciplinary_actions for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists disciplinary_actions_delete on public.disciplinary_actions;
create policy disciplinary_actions_delete on public.disciplinary_actions for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('discipline.cases.manage')));

drop policy if exists welfare_concerns_select on public.welfare_concerns;
create policy welfare_concerns_select on public.welfare_concerns for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('welfare.read_any')
        or raised_by = auth_school_user_id()
      )
    )
  );

drop policy if exists welfare_concerns_insert on public.welfare_concerns;
create policy welfare_concerns_insert on public.welfare_concerns for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('welfare.write')));

drop policy if exists welfare_concerns_update on public.welfare_concerns;
create policy welfare_concerns_update on public.welfare_concerns for update
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('welfare.read_any')
        or raised_by = auth_school_user_id()
      )
    )
  )
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('welfare.write')));

drop policy if exists welfare_concerns_delete on public.welfare_concerns;
create policy welfare_concerns_delete on public.welfare_concerns for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('welfare.read_any')));

drop policy if exists safeguarding_reports_select on public.safeguarding_reports;
create policy safeguarding_reports_select on public.safeguarding_reports for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('safeguarding.read')));

drop policy if exists safeguarding_reports_insert on public.safeguarding_reports;
create policy safeguarding_reports_insert on public.safeguarding_reports for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('safeguarding.write')));

drop policy if exists safeguarding_reports_update on public.safeguarding_reports;
create policy safeguarding_reports_update on public.safeguarding_reports for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('safeguarding.read')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('safeguarding.write')));

drop policy if exists safeguarding_reports_delete on public.safeguarding_reports;
create policy safeguarding_reports_delete on public.safeguarding_reports for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('safeguarding.write')));
