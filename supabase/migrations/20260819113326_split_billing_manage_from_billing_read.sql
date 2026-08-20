-- cancel_subscription() previously gated on billing.read, a permission
-- labeled "View school's platform subscription/billing" -- meaning granting
-- someone read-only billing visibility (e.g. an accountant, via the per-user
-- override UI) silently also gave them the power to cancel the subscription
-- and suspend the whole school. Split that out into its own billing.manage
-- permission, seeded only for school_owner (the sole role that currently
-- has billing.read), so this is a zero-behavior-change fix for existing
-- data while closing the gap for any future grant.

insert into role_permissions (role_id, school_id, permission_key, allowed)
values ('2ac7aada-0039-4d39-ae13-3c3dc185bde7', null, 'billing.manage', true)
on conflict do nothing;

create or replace function public.cancel_subscription(p_school_id uuid, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    auth_is_super_admin()
    or auth.role() = 'service_role'
    or (auth_school_id() = p_school_id and auth_has_permission('billing.manage'))
  ) then
    raise exception 'Not authorized to cancel this subscription.';
  end if;

  update school_subscriptions
    set status = 'cancelled', cancellation_reason = p_reason, updated_at = now()
    where school_id = p_school_id;
  if not found then raise exception 'No subscription exists for this school.'; end if;

  update schools set status = 'suspended', updated_at = now() where id = p_school_id;
end;
$function$;
