-- WP 1.3b (1/2): which STK requests may the mpesa-stk-push INTERNAL mode dispatch? ADDITIVE ONLY.
--
-- Pay by Link (WP 1.3) and the WhatsApp bot (WP 2.3) raise STK requests with no signed-in staff member, so they cannot
-- call mpesa-stk-push with a user JWT. The function gets a second mode authenticated by the shared DISPATCH_SECRET header
-- (the same pattern as mpesa-stk-query). To keep that mode from being a general "push to any request" door, it first asks
-- this function, and only dispatches requests that were created by a feature that is allowed to use it. Today that is Pay by
-- Link attempts. WP 2.3 will extend this function (create or replace) to include bot requests.
--
-- Nothing existing is edited; this is a new service_role-only function. It changes no behaviour until the edge function
-- that calls it is deployed (next PR).

create or replace function public.mpesa_stk_internal_dispatch_allowed(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.pay_link_attempts a where a.stk_request_id = p_request_id);
$function$;

revoke all on function public.mpesa_stk_internal_dispatch_allowed(uuid) from public, anon, authenticated;
grant execute on function public.mpesa_stk_internal_dispatch_allowed(uuid) to service_role;

-- Rollback: drop function public.mpesa_stk_internal_dispatch_allowed(uuid); (nothing calls it until the edge function change ships)
