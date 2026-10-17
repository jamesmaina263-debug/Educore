-- H1 (security audit 2026-10-04): the platform super-admin is one shared login with no MFA.
--
-- This migration is BEHAVIOUR-NEUTRAL when applied: the enforcement flag defaults to false, and
-- with the flag false auth_is_super_admin() returns exactly what it returned before. Nothing
-- changes for any user until an operator deliberately runs
--     select public.set_admin_mfa_required(true);
-- from the Supabase SQL editor (service role / postgres), after every operator has enrolled a
-- TOTP authenticator at /admin/mfa. The same call with `false` is the instant rollback.
--
-- What enforcement does once on:
--   * auth_is_super_admin() additionally requires the session JWT to be aal2 (a TOTP code was
--     verified in this session). Every platform RPC and every RLS policy that calls it is covered,
--     so the control holds even if someone calls a Server Action / PostgREST directly and never
--     touches the admin UI.
--   * The set of verified TOTP factors is pinned at the moment the flag is turned on. If any
--     verified factor that is NOT in the pinned set exists on the super-admin account (for example
--     an attacker who knows the shared password enrols their own authenticator), the account is
--     denied until an operator re-pins. Fail-closed on purpose. Adding or removing an operator
--     later = run set_admin_mfa_required(true) again to re-pin.

-- 1. Settings table: deny-all (RLS on, no policies, no grants). Read only by the SECURITY DEFINER
--    functions below and by service_role.
create table if not exists public.platform_security_settings (
  key         text primary key,
  bool_value  boolean not null default false,
  json_value  jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.platform_security_settings enable row level security;
revoke all on public.platform_security_settings from anon, authenticated;

insert into public.platform_security_settings (key, bool_value)
values ('admin_mfa_required', false)
on conflict (key) do nothing;

-- 2. The original check, kept under a new name. Used ONLY where the app must know "is this person a
--    platform admin at all" before they have completed MFA (admin layout, /admin/mfa page, login
--    routing). It confers no data access by itself: no RLS policy or RPC uses it.
create or replace function public.auth_is_super_admin_any_aal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from school_users su
    join roles r on r.id = su.role_id
    where su.auth_user_id = auth.uid()
      and su.status = 'active'
      and r.name = 'super_admin'
  );
$$;

revoke all on function public.auth_is_super_admin_any_aal() from public, anon;
grant execute on function public.auth_is_super_admin_any_aal() to authenticated, service_role;

-- 3. Lets the app learn whether enforcement is on, without exposing the settings table.
create or replace function public.admin_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select bool_value from public.platform_security_settings where key = 'admin_mfa_required'),
    false
  );
$$;

revoke all on function public.admin_mfa_required() from public, anon;
grant execute on function public.admin_mfa_required() to authenticated, service_role;

-- 4. The real control. With the flag false this is identical to the previous definition.
--    CREATE OR REPLACE keeps the existing grants (authenticated, service_role).
create or replace function public.auth_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_is_super_admin_any_aal()
    and (
      not public.admin_mfa_required()
      or (
        coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        and not exists (
          select 1
          from auth.mfa_factors f
          where f.user_id = auth.uid()
            and f.status = 'verified'
            and jsonb_array_length(
                  coalesce((select json_value from public.platform_security_settings
                            where key = 'admin_mfa_pinned_factors'), '[]'::jsonb)
                ) > 0
            and not exists (
                  select 1
                  from jsonb_array_elements_text(
                         coalesce((select json_value from public.platform_security_settings
                                   where key = 'admin_mfa_pinned_factors'), '[]'::jsonb)
                       ) pinned(id)
                  where pinned.id = f.id::text
                )
        )
      )
    );
$$;

-- 5. The switch. service_role / SQL editor only. Refuses to turn enforcement on unless enough
--    verified TOTP factors already exist on active super_admin accounts, so it cannot lock the
--    platform out by accident. Turning it off is always allowed.
create or replace function public.set_admin_mfa_required(p_required boolean, p_min_factors integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids jsonb;
  v_n   integer;
begin
  if p_required then
    select coalesce(jsonb_agg(f.id::text order by f.created_at), '[]'::jsonb), count(*)
      into v_ids, v_n
    from auth.mfa_factors f
    join public.school_users su on su.auth_user_id = f.user_id and su.status = 'active'
    join public.roles r on r.id = su.role_id and r.name = 'super_admin'
    where f.status = 'verified'
      and f.factor_type = 'totp';

    if v_n < greatest(coalesce(p_min_factors, 1), 1) then
      raise exception
        'Refusing to require admin MFA: % verified TOTP factor(s) on active super_admin accounts, need at least %.',
        v_n, greatest(coalesce(p_min_factors, 1), 1);
    end if;

    insert into public.platform_security_settings (key, json_value, updated_at)
    values ('admin_mfa_pinned_factors', v_ids, now())
    on conflict (key) do update set json_value = excluded.json_value, updated_at = now();
  end if;

  insert into public.platform_security_settings (key, bool_value, updated_at)
  values ('admin_mfa_required', p_required, now())
  on conflict (key) do update set bool_value = excluded.bool_value, updated_at = now();

  return jsonb_build_object(
    'admin_mfa_required', p_required,
    'pinned_factor_count', case when p_required then v_n else null end
  );
end;
$$;

revoke all on function public.set_admin_mfa_required(boolean, integer) from public, anon, authenticated;
grant execute on function public.set_admin_mfa_required(boolean, integer) to service_role;
