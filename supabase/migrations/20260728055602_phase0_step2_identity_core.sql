-- Phase 0, Step 2: Identity & access core
-- schools, school_groups, roles, role_permissions, school_users + RLS

create extension if not exists "pgcrypto";

-- generic updated_at trigger, reused across every table in the project
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- school_groups (Part K: multi-campus data-model groundwork)
-- ============================================================
create table school_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_school_groups_updated_at
  before update on school_groups
  for each row execute function set_updated_at();

-- ============================================================
-- schools
-- ============================================================
create table schools (
  id uuid primary key default gen_random_uuid(),
  school_group_id uuid references school_groups(id) on delete set null,
  name text not null,
  slug text not null unique,
  motto text,
  logo_url text,
  address text,
  phone text,
  email text,
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_schools_school_group_id on schools(school_group_id);

create trigger trg_schools_updated_at
  before update on schools
  for each row execute function set_updated_at();

-- ============================================================
-- roles (12 system-defined roles, platform-wide, not per-tenant)
-- ============================================================
create table roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  description text,
  is_system_role boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_roles_updated_at
  before update on roles
  for each row execute function set_updated_at();

insert into roles (name, display_name, description) values
  ('super_admin', 'Super Admin', 'Trimora staff; cross-school visibility for support/billing only'),
  ('school_owner', 'School Owner', 'Full access across the school'),
  ('principal', 'Principal', 'Full access across the school'),
  ('deputy_principal', 'Deputy Principal', 'Full students/exams access, read-only elsewhere'),
  ('bursar', 'Bursar', 'Full finance access'),
  ('teacher', 'Teacher', 'Own classes: marks entry, no admin access'),
  ('class_teacher', 'Class Teacher', 'Own class: students, attendance, marks'),
  ('librarian', 'Librarian', 'Library module only (Phase 3)'),
  ('transport_manager', 'Transport Manager', 'Transport module only (Phase 3)'),
  ('hostel_warden', 'Hostel Warden', 'Hostel module + own boarders (Phase 3)'),
  ('parent', 'Parent', 'Own child(ren) only, read-mostly'),
  ('student', 'Student', 'Own profile/results only, read-only');

-- ============================================================
-- role_permissions
-- school_id IS NULL  -> platform default for that role
-- school_id NOT NULL -> per-school override (Settings §7.8), same role
-- ============================================================
create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  school_id uuid references schools(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Distinct partial unique indexes: NULL school_id (defaults) vs a specific
-- school_id (overrides) can't both be covered by one UNIQUE constraint,
-- since NULL never equals NULL in a standard unique constraint.
create unique index uq_role_permissions_default
  on role_permissions(role_id, permission_key)
  where school_id is null;

create unique index uq_role_permissions_override
  on role_permissions(role_id, school_id, permission_key)
  where school_id is not null;

create index idx_role_permissions_school_id on role_permissions(school_id);

create trigger trg_role_permissions_updated_at
  before update on role_permissions
  for each row execute function set_updated_at();

-- Minimal seed: only what Step 2's own RLS policies need to prove out.
-- Every other module seeds its own permission keys when it's built.
insert into role_permissions (role_id, permission_key, allowed)
select id, 'staff.manage', true from roles where name in ('school_owner', 'principal', 'deputy_principal')
union all
select id, 'settings.branding.write', true from roles where name in ('school_owner', 'principal')
union all
select id, 'settings.roles.manage', true from roles where name = 'school_owner';

-- ============================================================
-- school_users (staff/parent/student accounts scoped to a school)
-- ============================================================
create table school_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  school_id uuid references schools(id) on delete cascade,
  school_group_id uuid references school_groups(id) on delete set null,
  role_id uuid not null references roles(id),
  full_name text not null,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_school_users_school_id on school_users(school_id);
create index idx_school_users_role_id on school_users(role_id);

create trigger trg_school_users_updated_at
  before update on school_users
  for each row execute function set_updated_at();

-- Only super_admin may have a null school_id (cross-school platform staff).
-- Everyone else must be scoped to exactly one school.
create or replace function enforce_school_user_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role_name text;
begin
  select name into v_role_name from roles where id = new.role_id;
  if v_role_name = 'super_admin' then
    if new.school_id is not null then
      raise exception 'super_admin accounts must not be scoped to a single school_id';
    end if;
  else
    if new.school_id is null then
      raise exception 'school_id is required for all roles except super_admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_school_users_enforce_scope
  before insert or update on school_users
  for each row execute function enforce_school_user_scope();

-- Prevent a non-privileged user from escalating their own privileges via
-- a self-service profile update (the exact class of gap found in the POS
-- codebase: caller-supplied tenant/role fields silently overriding the
-- resolved identity). Only super_admin or someone with staff.manage may
-- change role_id, school_id, or status; anyone may still update their own
-- contact fields (full_name, email, phone).
create or replace function prevent_school_user_privilege_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_caller_is_super_admin boolean;
  v_caller_has_staff_manage boolean;
  v_caller_id uuid := auth.uid();
begin
  select exists (
    select 1 from school_users su join roles r on r.id = su.role_id
    where su.auth_user_id = v_caller_id and su.status = 'active' and r.name = 'super_admin'
  ) into v_caller_is_super_admin;

  if v_caller_is_super_admin then
    return new;
  end if;

  select public.auth_has_permission('staff.manage') into v_caller_has_staff_manage;

  if v_caller_has_staff_manage then
    return new;
  end if;

  if new.role_id is distinct from old.role_id
     or new.school_id is distinct from old.school_id
     or new.status is distinct from old.status then
    raise exception 'insufficient privileges to change role_id, school_id, or status';
  end if;

  return new;
end;
$$;
