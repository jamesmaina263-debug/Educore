-- ============================================================================
-- Lets a procurement officer (inventory_officer) message suppliers from
-- Communication -- without giving them communication.write, which would also
-- open guardian/student/staff messaging they have no business touching.
--
-- New permission communication.supplier is intentionally narrower than
-- communication.write, not an alias for it: auth_can_message_suppliers()
-- accepts either, so existing communication.write holders (bursar, deputy
-- principal, principal, school_owner) gain supplier messaging for free, while
-- a communication.supplier-only holder can never touch anything else --
-- enforced at the RLS layer (notification_logs_select), not just hidden in
-- the UI, so a crafted request can't see past it either.
-- ============================================================================

create or replace function public.auth_can_message_suppliers()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth_has_permission('communication.write') or auth_has_permission('communication.supplier');
$$;

revoke all on function public.auth_can_message_suppliers() from public, anon;
grant execute on function public.auth_can_message_suppliers() to authenticated;

-- Default grant: the procurement officer role. (Leadership roles already
-- pass auth_can_message_suppliers() via communication.write and don't need
-- this row too.)
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'communication.supplier', true
from public.roles r
where r.name = 'inventory_officer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'communication.supplier'
  );

-- One-off, ad hoc message to a single supplier (distinct from
-- queue_communication, which is a bulk guardian/student/staff broadcast
-- gated strictly on communication.write -- a supplier-only sender should
-- never be able to reach that function, or its roster of guardian contacts).
create or replace function public.queue_supplier_message(p_supplier_id uuid, p_subject text, p_body text)
returns public.notification_logs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_supplier_email text;
  v_result public.notification_logs;
begin
  if not auth_can_message_suppliers() then
    raise exception 'insufficient permissions: communication.write or communication.supplier required';
  end if;
  if p_subject is null or btrim(p_subject) = '' then
    raise exception 'subject is required';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'message body is required';
  end if;

  select email into v_supplier_email from public.suppliers where id = p_supplier_id and school_id = v_school_id;
  if v_supplier_email is null then
    raise exception 'supplier not found in this school, or has no email on file';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  insert into public.notification_logs (school_id, recipient_email, recipient_phone, recipient_type, channel, subject, body, status, segments, sent_by)
  values (v_school_id, v_supplier_email, '-', 'supplier', 'email', p_subject, p_body, 'queued', 1, v_sender)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.queue_supplier_message(uuid, text, text) from public, anon;
grant execute on function public.queue_supplier_message(uuid, text, text) to authenticated;

-- Read access: same "one OR'd policy" convention as
-- 20260810064531_phase9_communication_check.sql (avoids stacking multiple
-- permissive policies on the same table). Adds a third branch so a
-- communication.supplier-only holder (no communication.read) sees supplier
-- rows in their school and nothing else -- they fail the first branch
-- (no communication.read) and the second (it's not their own in-app
-- notification), so only supplier-typed rows are visible to them.
drop policy notification_logs_select on public.notification_logs;
create policy notification_logs_select on public.notification_logs
  for select using (
    (school_id = auth_school_id() and auth_has_permission('communication.read'))
    or (recipient_school_user_id = (select id from school_users where auth_user_id = auth.uid()))
    or (school_id = auth_school_id() and recipient_type = 'supplier' and auth_has_permission('communication.supplier'))
  );
