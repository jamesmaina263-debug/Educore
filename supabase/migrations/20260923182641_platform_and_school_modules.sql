-- Generalizes the boarding_enabled pattern (schools.boarding_enabled, added 2026-09-17) to any
-- module a school might not need, without a new migration + schema change every time a module
-- gets added to the toggle list. Two tables, same catalog+override shape as
-- platform_feature_flags/school_feature_flags, but with the OPPOSITE default: absence of a
-- school_modules row means the module is ON, not off. Module toggles are opt-OUT (a school
-- starts with everything it has today and someone explicitly turns one off), whereas feature
-- flags are opt-IN (a beta a school explicitly gets added to). Conflating the two conventions
-- in one table would be a footgun, so this stays separate from platform_feature_flags entirely.
--
-- This migration is schema + catalog only. No existing route, nav item, or _data.ts is wired to
-- read this yet -- that is deliberately separate, per-module, follow-up work (mirroring how
-- platform_feature_flags shipped as inert registry-only infra first). schools.boarding_enabled
-- is untouched by this migration; Boarding is not yet represented in platform_modules.

create table public.platform_modules (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text not null,
  description text,
  -- Core modules (attendance, students, staff, admissions, reports) are never eligible for
  -- per-school disable -- listed here only so an admin UI can show *why* a module has no
  -- toggle, not so it can be toggled. App code must check is_core, not just enabled, before
  -- honoring any override (see school_module_enabled below, which enforces this itself).
  is_core boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index platform_modules_key_unique on public.platform_modules (lower(key));

create table public.school_modules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (school_id, module_id)
);

create index idx_school_modules_school on public.school_modules (school_id);

alter table public.platform_modules enable row level security;
alter table public.school_modules enable row level security;

-- Catalog: readable by any authenticated user (module keys/labels are harmless metadata, same
-- reasoning as platform_feature_flags), writable only by super_admin.
create policy platform_modules_select on public.platform_modules
  for select using (true);
create policy platform_modules_insert on public.platform_modules
  for insert with check (auth_is_super_admin());
create policy platform_modules_update on public.platform_modules
  for update using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy platform_modules_delete on public.platform_modules
  for delete using (auth_is_super_admin());

-- Per-school rows: super_admin manages every school's toggles from the admin console; a
-- school's own users can read (not write) only their own school's rows, mirroring
-- school_feature_flags exactly, so future app-code gating can query this under normal RLS.
create policy school_modules_select on public.school_modules
  for select using (auth_is_super_admin() or school_id = auth_school_id());
create policy school_modules_insert on public.school_modules
  for insert with check (auth_is_super_admin());
create policy school_modules_update on public.school_modules
  for update using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy school_modules_delete on public.school_modules
  for delete using (auth_is_super_admin());

revoke all on public.platform_modules, public.school_modules from public, anon;
grant select, insert, update, delete on public.platform_modules to authenticated;
grant select, insert, update, delete on public.school_modules to authenticated;

-- Convenience lookup for future app-code gating (e.g. a replacement for the ad hoc
-- boarding_enabled check in boarding/_data.ts, once Boarding itself is migrated into this
-- system as its own follow-up PR). Absence of a row, OR the module being flagged is_core, both
-- read as enabled=true -- a typo'd key or an attempt to disable a core module both fail safe
-- (module stays visible) rather than silently locking a school out of something essential.
create or replace function public.school_module_enabled(p_school_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select sm.enabled
      from public.school_modules sm
      join public.platform_modules pm on pm.id = sm.module_id
      where sm.school_id = p_school_id
        and lower(pm.key) = lower(p_key)
        and pm.is_core = false
    ),
    true
  );
$$;
revoke all on function public.school_module_enabled(uuid, text) from public;
grant execute on function public.school_module_enabled(uuid, text) to authenticated;

-- Seed the catalog. is_core=true entries exist purely as documentation/UI signal (see comment
-- above) -- no school_modules row will ever be inserted for them by the admin UI once built.
insert into public.platform_modules (key, label, description, is_core) values
  ('attendance', 'Attendance', 'Daily attendance recording and reports.', true),
  ('students', 'Students', 'Core student records.', true),
  ('staff', 'Staff', 'Core staff records.', true),
  ('admissions', 'Admissions', 'Admissions pipeline and enrollment.', true),
  ('reports', 'Reports', 'Cross-module reporting.', true),
  ('health', 'Health', 'Sick bay visits and medication tracking.', false),
  ('transport', 'Transport', 'School transport/route management.', false),
  ('library', 'Library', 'Library catalog and lending.', false),
  ('payroll', 'Payroll', 'Staff payroll processing.', false),
  ('inventory', 'Inventory', 'Stock/asset inventory and requisitions.', false),
  ('discipline', 'Discipline', 'Discipline incident tracking.', false),
  ('homework', 'Homework', 'Homework assignment and submission tracking.', false),
  ('pt_meetings', 'Parent-Teacher Meetings', 'PT meeting scheduling.', false);
