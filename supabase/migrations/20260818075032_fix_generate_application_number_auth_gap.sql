-- SECURITY FIX: generate_application_number(uuid) was SECURITY DEFINER with no internal
-- auth check and EXECUTE granted to anon/PUBLIC, so anyone holding only the public anon key
-- could call it directly via PostgREST with an arbitrary school_id and learn that school's
-- current application-numbering sequence (minor cross-tenant info disclosure; no PII).
--
-- Two legitimate callers exist:
--   1. src/app/apply/[slug]/actions.ts — public application form, uses the service-role
--      (admin) client server-side. Untouched: service_role keeps EXECUTE and is never
--      exposed to a browser.
--   2. src/app/(app)/admissions/walk-in-actions.ts — signed-in staff action, uses the
--      session-bound client and always passes the caller's own school_id.
--
-- Fix: revoke EXECUTE from anon/PUBLIC (closes the unauthenticated attack surface at the
-- grant level), and add an internal guard so an authenticated caller can only request a
-- number for their own school — consistent with every sibling function in this file.
-- Calls where auth.uid() is null (the service-role path) are left unrestricted, matching
-- existing behavior for the public apply flow.

create or replace function public.generate_application_number(p_school_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year text := to_char(now(), 'YYYY');
  v_next int;
begin
  if auth.uid() is not null and auth_school_id() is distinct from p_school_id then
    raise exception 'not authorized for this school';
  end if;

  select coalesce(max(substring(application_number from '\d+$')::int), 0) + 1
    into v_next
    from public.applications
    where school_id = p_school_id and application_number like 'APP-' || v_year || '-%';
  return 'APP-' || v_year || '-' || lpad(v_next::text, 5, '0');
end;
$function$;

revoke execute on function public.generate_application_number(uuid) from public;
revoke execute on function public.generate_application_number(uuid) from anon;
grant execute on function public.generate_application_number(uuid) to authenticated, service_role;
