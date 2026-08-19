-- Phase 22: per-user permission overrides.
--
-- role_permissions already lets a school override the *default* grants for
-- one of the 12 system roles, school-wide (school_id, role_id, permission_key).
-- That's necessary but not sufficient: an Admin/Owner needs to grant or revoke
-- an individual permission for one specific staff member without creating a
-- whole new role for them.
--
-- Precedence (highest to lowest):
--   1. user_permission_overrides  (this table — one user, one key)
--   2. role_permissions (school_id = caller's school)  (existing — one role, one school)
--   3. role_permissions (school_id is null)             (existing — platform default)
--   4. false
--
-- auth_has_permission() is updated below to add step 1. Steps 2-4 are
-- byte-identical to the existing function, so behavior is unchanged for
-- every school until a row is actually inserted into this new table.

-- Small helper (mirrors auth_school_id()) so we can default granted_by
-- without a bare subquery in a DEFAULT clause (Postgres disallows that).
create or replace function public.auth_school_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from school_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null,
  granted_by uuid references public.school_users(id) on delete set null default auth_school_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_user_id, permission_key)
);

create index idx_user_permission_overrides_user on public.user_permission_overrides(school_user_id);
create index idx_user_permission_overrides_school on public.user_permission_overrides(school_id);

create trigger trg_user_permission_overrides_updated_at
  before update on public.user_permission_overrides
  for each row execute function public.set_updated_at();

-- Guard against a user_permission_overrides row pointing at a school_user
-- from a different school than school_id claims (mirrors the pattern used
-- for role_permissions overrides).
create or replace function public.enforce_user_permission_override_school_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from school_users
    where id = new.school_user_id and school_id = new.school_id
  ) then
    raise exception 'school_user_id % does not belong to school_id %', new.school_user_id, new.school_id;
  end if;
  return new;
end;
$$;

create trigger trg_user_permission_overrides_school_match
  before insert or update on public.user_permission_overrides
  for each row execute function public.enforce_user_permission_override_school_match();

alter table public.user_permission_overrides enable row level security;

-- Read: super_admin, or anyone in the same school with settings.roles.manage,
-- or a user reading their own overrides (so a staff member can see why they
-- can/can't do something without needing settings.roles.manage themselves).
create policy user_permission_overrides_select on public.user_permission_overrides
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('settings.roles.manage'))
    or school_user_id = auth_school_user_id()
  );

-- Write: same-school admin holding settings.roles.manage. Revoking (allowed = false)
-- is always permitted for anyone with that gate; granting (allowed = true) additionally
-- requires the granter to already hold that exact permission themselves, so someone
-- with settings.roles.manage (but not, say, finance.write) can't hand out finance
-- access they don't have -- the same "can't grant beyond your own reach" principle
-- as the existing school_users privilege-escalation trigger.
create policy user_permission_overrides_write on public.user_permission_overrides
  for all
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('settings.roles.manage'))
  )
  with check (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('settings.roles.manage')
      and (allowed = false or auth_has_permission(permission_key))
    )
  );

revoke all on public.user_permission_overrides from anon;

-- Extend auth_has_permission with the new top-precedence step.
create or replace function public.auth_has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select su.id as school_user_id, su.school_id, su.role_id
    from school_users su
    where su.auth_user_id = auth.uid()
      and su.status = 'active'
    limit 1
  ),
  user_override as (
    select upo.allowed
    from user_permission_overrides upo, caller c
    where upo.school_user_id = c.school_user_id
      and upo.permission_key = p_permission_key
  ),
  role_override as (
    select rp.allowed
    from role_permissions rp, caller c
    where rp.role_id = c.role_id
      and rp.school_id = c.school_id
      and rp.permission_key = p_permission_key
  ),
  default_grant as (
    select rp.allowed
    from role_permissions rp, caller c
    where rp.role_id = c.role_id
      and rp.school_id is null
      and rp.permission_key = p_permission_key
  )
  select coalesce(
    (select allowed from user_override),
    (select allowed from role_override),
    (select allowed from default_grant),
    false
  );
$$;
