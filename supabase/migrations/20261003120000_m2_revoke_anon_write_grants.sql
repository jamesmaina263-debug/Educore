-- M2 (security audit): remove the `anon` role's ability to write to public tables.
--
-- Background: this project's default privileges (confirmed live via pg_default_acl) grant
-- INSERT/UPDATE/DELETE/TRUNCATE on every new public table to `anon` -- the role used by any
-- request with no login session. Row Level Security is what actually stops anon writing
-- today: every tenant write policy is gated on auth_school_id() / auth_is_super_admin() /
-- auth_has_permission(), which are null/false for anon (verified against live pg_policy on
-- 2026-10-03: zero write policies are reachable by anon without such a gate). So this is
-- defense in depth: one forgotten or mis-written policy would otherwise be a direct
-- unauthenticated write path, because the table grant underneath it is wide open.
--
-- The only two policies that deliberately let anon write were the public marketing forms.
-- Their writers moved to the service-role admin client (#516 contact, #518 lead magnet) and
-- the policies/grants on those two tables were closed in 20261003050000 (#522). This
-- migration is the schema-wide follow-up.
--
-- Production traffic check (edge logs, 24h, 2026-10-03): direct table writes came only from
-- the service role or logged-in staff sessions; none from anon. Nothing in src/ writes as
-- anon (every public form uses createAdminClient()).
--
-- Not touched: SELECT grants (anon legitimately reads e.g. platform_maintenance before
-- login), anything for `authenticated` or `service_role`, SECURITY DEFINER functions, storage.
--
-- Idempotent, and fail-closed: the DO block raises (rolling this whole migration back) if anon
-- still holds any write privilege on a table this migration is responsible for.
--
-- Rollback (only if a regression is found; restores the old, wider behaviour):
--   grant insert, update, delete, truncate on all tables in schema public to anon;
--   alter default privileges for role postgres in schema public
--     grant insert, update, delete, truncate on tables to anon;
--   (then re-run revoke on marketing_leads / marketing_demo_requests as 20261003050000 does)

-- 1. Revoke anon's write privileges on every existing table / partitioned table / view in
--    public that this migration role owns.
do $m2$
declare
  r        record;
  p        text;
  privs    text[] := array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  leftover text;
  skipped  integer;
begin
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v')
      and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('revoke insert, update, delete, truncate on table public.%I from anon', r.relname);

    -- anon also inherits whatever is granted to PUBLIC (see the H6 migration notes). If a bare
    -- PUBLIC grant is what still lets anon write, move that access onto the two named roles
    -- that legitimately hold it, then drop it from PUBLIC. This never reduces what
    -- authenticated / service_role can already do -- it only makes their access explicit.
    foreach p in array privs loop
      if has_table_privilege('anon', r.oid, p) then
        execute format('grant %s on table public.%I to authenticated, service_role', p, r.relname);
        execute format('revoke %s on table public.%I from public', p, r.relname);
      end if;
    end loop;
  end loop;

  -- Verify. Anything left is an unexpected grant path we must not paper over.
  select string_agg(format('%s(%s)', c.relname, u.priv), ', ' order by c.relname, u.priv)
    into leftover
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(privs) as u(priv)
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v')
    and pg_get_userbyid(c.relowner) = current_user
    and has_table_privilege('anon', c.oid, u.priv);

  if leftover is not null then
    raise exception 'M2: anon still has write privileges on: %', leftover;
  end if;

  -- Objects owned by another role (e.g. created by Supabase tooling) are out of reach of this
  -- migration role; report rather than fail.
  select count(*) into skipped
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(privs) as u(priv)
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v')
    and pg_get_userbyid(c.relowner) <> current_user
    and has_table_privilege('anon', c.oid, u.priv);
  if skipped > 0 then
    raise notice 'M2: % anon write privilege(s) remain on public objects owned by another role', skipped;
  end if;
end
$m2$;

-- 2. Same fix as 20260913123452 did for functions: new tables created by this repo's migrations
--    (role postgres) should not hand anon write access by default.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;
