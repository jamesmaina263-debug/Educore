-- M2 follow-up (security audit). Two privilege-only clean-ups left over after
-- 20261003120000 (M2). No data, policy or function logic is changed.
--
-- 1. TRUNCATE for `authenticated`.
--    Row Level Security does not apply to TRUNCATE, so a table-level TRUNCATE grant lets a
--    logged-in role wipe a whole table (every school's rows) regardless of any policy.
--    PostgREST does not expose TRUNCATE, so this is only reachable through a direct database
--    connection as that role -- but nothing legitimate needs it. Verified before writing this:
--      * no SQL function in public contains a TRUNCATE statement;
--      * nothing in src/, supabase/functions, scripts, loadtest or .github issues TRUNCATE;
--      * service_role keeps TRUNCATE on every table (untouched), as do owner-run
--        SECURITY DEFINER functions and migrations.
--    Also removed from the default privileges so future tables don't inherit it.
--
-- 2. `anon` USAGE/UPDATE on three sequences.
--    application_number_seq, receipt_number_seq and student_payment_reference_seq were
--    usable by anon. Verified: no column default uses them, and the only function that
--    references them (ensure_student_financial_account_for_webhook) is SECURITY DEFINER and
--    not executable by anon, so revoking cannot affect it. authenticated / service_role
--    sequence privileges are untouched.
--
-- NOT fixable here: default privileges for tables created by the `supabase_admin` role still
-- give anon full access. The migration role (postgres) is not a member of supabase_admin and
-- cannot alter them. Migrations create tables as postgres, so this only matters for tables
-- created by hand through Supabase tooling as supabase_admin.
--
-- Idempotent and fail-closed (raises, rolling the migration back, if authenticated still has
-- TRUNCATE on a table this role owns).
--
-- Rollback (only if a regression is found):
--   grant truncate on all tables in schema public to authenticated;
--   alter default privileges for role postgres in schema public grant truncate on tables to authenticated;
--   grant usage, update on sequence public.application_number_seq, public.receipt_number_seq,
--     public.student_payment_reference_seq to anon;

do $f$
declare
  r        record;
  leftover text;
begin
  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('revoke truncate on table public.%I from authenticated', r.relname);
  end loop;

  select string_agg(c.relname, ', ' order by c.relname)
    into leftover
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and pg_get_userbyid(c.relowner) = current_user
    and has_table_privilege('authenticated', c.oid, 'TRUNCATE');

  if leftover is not null then
    raise exception 'M2 follow-up: authenticated still has TRUNCATE on: %', leftover;
  end if;
end
$f$;

alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated;

do $s$
declare
  s text;
begin
  foreach s in array array['application_number_seq', 'receipt_number_seq', 'student_payment_reference_seq'] loop
    if to_regclass(format('public.%I', s)) is not null then
      execute format('revoke usage, update on sequence public.%I from anon', s);
    end if;
  end loop;
end
$s$;
