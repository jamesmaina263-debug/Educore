-- Reconciliation: this migration is already live in production (applied 2026-09-04, matching
-- #233's app-code change) but the schema portion was never committed to the repo -- caught by
-- the migration drift check. Content below is copied verbatim from
-- supabase_migrations.schema_migrations so the repo matches what's actually running.
--
-- Correction: knec_cba_assessment_windows was originally built as global, platform-staff-authored
-- reference data (managed at /admin/cba-windows, super_admin-only). Per product direction, this
-- was wrong: EduCore's platform admin (the software owner) has no operational stake in any one
-- school's KNEC CBA deadlines, and schools have no "school admin" role -- school management
-- (school_owner/principal/deputy_principal, plus academic_officer per the existing knec.manage
-- grant from the CBA export feature) is who should track and enter these. This migration
-- converts the table from a single global list to per-school data, scoped and RLS-gated exactly
-- like the rest of the KNEC CBA feature (knec.manage + school_id = auth_school_id()).
--
-- Table is empty in production (confirmed via count before this migration), so no backfill is
-- needed for the new NOT NULL school_id column.

alter table public.knec_cba_assessment_windows
  add column school_id uuid references public.schools(id) on delete cascade;

-- Backfill is a no-op today (0 rows) but included for correctness if this ever runs on a branch
-- with seed data; there is no sensible single school to attribute an existing global row to, so
-- surface that loudly rather than silently guessing.
do $$
begin
  if exists (select 1 from public.knec_cba_assessment_windows where school_id is null) then
    raise exception 'knec_cba_assessment_windows has existing rows with no school to attribute them to -- resolve manually before making school_id not null';
  end if;
end $$;

alter table public.knec_cba_assessment_windows
  alter column school_id set not null;

comment on table public.knec_cba_assessment_windows is
  'Per-school reference list of KNEC-published CBA/SBA assessment windows, authored by that
school''s own management (knec.manage: school_owner/principal/deputy_principal/academic_officer)
via Integrations > KNEC CBA -- not platform-staff-authored. Surfaced as an in-app reminder in the
same page (see knec_cba_window_dismissals for dismiss state).';

create index idx_knec_cba_assessment_windows_school_id on public.knec_cba_assessment_windows(school_id);
-- Superseded by the school-scoped index below.
drop index if exists public.idx_knec_cba_assessment_windows_closes_at;
create index idx_knec_cba_assessment_windows_school_closes_at
  on public.knec_cba_assessment_windows(school_id, closes_at) where is_active;

-- Replace the old super_admin-only RLS with school-scoped + knec.manage, same shape as every
-- other KNEC CBA table (see knec_cba_export_batches policies).
drop policy knec_cba_assessment_windows_select on public.knec_cba_assessment_windows;
drop policy knec_cba_assessment_windows_insert on public.knec_cba_assessment_windows;
drop policy knec_cba_assessment_windows_update on public.knec_cba_assessment_windows;
drop policy knec_cba_assessment_windows_delete on public.knec_cba_assessment_windows;

create policy knec_cba_assessment_windows_select on public.knec_cba_assessment_windows
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
);

create policy knec_cba_assessment_windows_insert on public.knec_cba_assessment_windows
for insert
with check (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
);

create policy knec_cba_assessment_windows_update on public.knec_cba_assessment_windows
for update
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
)
with check (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
);

create policy knec_cba_assessment_windows_delete on public.knec_cba_assessment_windows
for delete
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
);
