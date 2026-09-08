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
