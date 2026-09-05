-- The demo-requests admin page (/admin/demo-requests) has been read-only since the table
-- was created (see 20260828203537_marketing_demo_requests.sql's module comment) -- that
-- lockdown was aimed at the *public, unauthenticated* insert path, not at platform staff
-- working the leads once they exist. There's now a real funnel of leads sitting in `status`
-- with no way to mark one contacted/closed short of hand-editing via Supabase Studio.
--
-- Rather than adding a table-level UPDATE RLS policy (which would let a super admin update
-- any column, including name/email/message), this exposes a narrow SECURITY DEFINER RPC that
-- can only ever change `status`, to a fixed set of values. Same authorization convention as
-- admin_school_last_active() and the billing lifecycle functions: auth_is_super_admin() or
-- the service role, checked in the function body since this isn't RLS-shaped.
--
-- No DELETE capability is added here, matching the original lockdown intent -- this is
-- additive, not a reversal of it.
create or replace function public.admin_update_demo_request_status(
  p_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to update demo request status.';
  end if;

  if p_status not in ('new', 'contacted', 'closed') then
    raise exception 'Invalid status: %', p_status;
  end if;

  update public.marketing_demo_requests
  set status = p_status
  where id = p_id;

  if not found then
    raise exception 'Demo request not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_update_demo_request_status(uuid, text) from public;
grant execute on function public.admin_update_demo_request_status(uuid, text) to authenticated;
