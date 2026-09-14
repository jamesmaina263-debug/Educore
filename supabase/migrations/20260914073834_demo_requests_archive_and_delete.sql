-- Requested directly by the project owner: demo requests were overpiling in
-- /admin/demo-requests (26 rows, 22 still "new") with no way to declutter the list
-- short of hand-editing via Supabase Studio. "Mark as closed" already existed as a
-- status value (see 20260905062737); this adds the two missing actions: archiving
-- (soft, reversible -- hides a row from the default list without losing it) and
-- permanent delete (hard, irreversible -- for genuine noise/spam/duplicates).
--
-- This is a deliberate, explicit reversal of the original table comment's "No DELETE
-- capability is added here" note (20260905062737) -- that note captured the design
-- intent *at the time*; the owner has now asked for delete directly. Same narrow
-- SECURITY DEFINER RPC convention as admin_update_demo_request_status: each function
-- can only do its one job (archive-toggle or delete-by-id), not arbitrary column
-- writes, and each carries its own auth_is_super_admin() check since this isn't
-- RLS-shaped.

alter table public.marketing_demo_requests
  add column if not exists archived_at timestamptz;

comment on column public.marketing_demo_requests.archived_at is
  'Set when platform staff archive a request to declutter the default /admin/demo-requests list. Null = active/visible by default. Reversible via admin_archive_demo_request(p_id, false).';

create or replace function public.admin_archive_demo_request(p_id uuid, p_archived boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to archive demo requests.';
  end if;

  update public.marketing_demo_requests
  set archived_at = case when p_archived then now() else null end
  where id = p_id;

  if not found then
    raise exception 'Demo request not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_archive_demo_request(uuid, boolean) from public;
grant execute on function public.admin_archive_demo_request(uuid, boolean) to authenticated;

create or replace function public.admin_delete_demo_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to delete demo requests.';
  end if;

  delete from public.marketing_demo_requests where id = p_id;

  if not found then
    raise exception 'Demo request not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_demo_request(uuid) from public;
grant execute on function public.admin_delete_demo_request(uuid) to authenticated;
