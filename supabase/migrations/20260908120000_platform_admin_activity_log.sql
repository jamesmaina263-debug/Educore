-- Platform staff activity log: "a log of what was done via the admin console (plan changes,
-- suspensions, impersonation) becomes important fast" once there's more than one platform
-- admin. Only one exists today, so this is low-urgency but cheap to lay down now while the
-- call sites are fresh, rather than retrofitting it once it actually matters.
--
-- Deliberately app-layer (server actions call log_platform_admin_action() right after a
-- successful mutation), not a generic DB trigger over every admin-touched table -- the ask is
-- specifically "what was done via the admin console", and several admin actions are direct
-- table updates protected by a row-level trigger (school_groups' whitelabel setters) rather
-- than a SECURITY DEFINER RPC, so there's no single choke point to hang a trigger off of
-- uniformly. actor_email is captured from auth.email() at write time rather than joined at
-- read time, so the log stays readable even if an admin's account is later removed.
create table public.platform_admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_email text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_platform_admin_activity_log_created_at on public.platform_admin_activity_log (created_at desc);

alter table public.platform_admin_activity_log enable row level security;

create policy platform_admin_activity_log_select
  on public.platform_admin_activity_log
  for select
  using (auth_is_super_admin());

revoke insert, update, delete, truncate on public.platform_admin_activity_log from anon, authenticated;

-- The only write path. Captures actor_user_id/actor_email from the caller's own JWT (auth.uid()/
-- auth.email()) rather than trusting a client-supplied value, so a log entry can't be
-- attributed to someone other than whoever was actually signed in when the action ran.
create or replace function public.log_platform_admin_action(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to write to the platform admin activity log.';
  end if;

  insert into public.platform_admin_activity_log (actor_user_id, actor_email, action, detail)
  values (auth.uid(), auth.email(), p_action, coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.log_platform_admin_action(text, jsonb) from public;
grant execute on function public.log_platform_admin_action(text, jsonb) to authenticated;
