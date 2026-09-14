-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260914080847 -- reconstructed, not rewritten.

-- Requested directly by the project owner: assign a demo request to a named colleague,
-- which should (a) set status to 'assigned', and (b) email that colleague the full lead
-- details, sent from the owner's own address (james.maina@educoreafrica.com, already
-- shown to platform staff as the connected mailbox on /admin/company-email) so it reads
-- as personally forwarded rather than a generic system notification.
--
-- Verified live before writing this: Resend delivery to a genuinely external address
-- (test@example.com, unrelated to any domain on this Resend account) succeeded with a
-- real 200 from Resend's API via the already-deployed notify-platform-admin function.
-- SECRETS_ROTATION_POLICY.md's 2026-08-22 note that RESEND_FROM_ADDRESS was still
-- Resend's sandbox onboarding@resend.dev (which only delivers to the account owner) is
-- now stale -- that restriction is confirmed gone.

-- Small, owner-managed list of platform colleagues who can be assigned a lead. No login
-- of their own -- they're notified by email, not new admin-console accounts. Same
-- narrow RLS convention as other admin-only tables here: select-only for super admins,
-- no anon/authenticated write policy (managed via Supabase Studio for now, same as this
-- table's small size warrants -- an in-app add/remove UI can follow if the list grows).
create table if not exists public.platform_team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.platform_team_members is
  'Platform staff who demo requests can be assigned to. They receive an email notification when assigned; they do not have their own admin-console login via this table.';

alter table public.platform_team_members enable row level security;

create policy "platform_team_members_select"
  on public.platform_team_members
  for select
  to authenticated
  using (auth_is_super_admin());

revoke insert, update, delete, truncate on public.platform_team_members from anon, authenticated;

insert into public.platform_team_members (name, email) values
  ('Ben Kimuyu', 'ben.kimuyu@educoreafrica.com'),
  ('Boniface', 'boniface.k@educoreafrica.com')
on conflict (email) do nothing;

alter table public.marketing_demo_requests
  add column if not exists assigned_to uuid references public.platform_team_members(id),
  add column if not exists assigned_at timestamptz;

comment on column public.marketing_demo_requests.assigned_to is
  'Platform colleague this lead is assigned to. Set via admin_assign_demo_request(), which also emails them the full lead details and sets status to ''assigned''.';

-- Widen the status check to add 'assigned', alongside the existing new/contacted/closed.
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

  if p_status not in ('new', 'contacted', 'assigned', 'closed') then
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

-- Assign (or unassign, when p_team_member_id is null) a demo request. Assigning sets
-- status to 'assigned' and emails the assignee the full lead details (same webhook
-- pattern as notify_admin_new_demo_request(): vault-stored shared secret, pg_net POST to
-- the notify-platform-admin edge function, now handling a second `kind`). Unassigning
-- clears assigned_to/assigned_at but deliberately leaves status untouched -- reverting
-- status wasn't asked for and guessing at it risks clobbering a status the admin set on
-- purpose in between.
create or replace function public.admin_assign_demo_request(
  p_id uuid,
  p_team_member_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_webhook_secret text;
  v_project_url text := 'https://alzqlvfaftwegptfbfej.supabase.co';
  v_member record;
  v_request record;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to assign demo requests.';
  end if;

  if p_team_member_id is null then
    update public.marketing_demo_requests
    set assigned_to = null, assigned_at = null
    where id = p_id;

    if not found then
      raise exception 'Demo request not found: %', p_id;
    end if;

    return;
  end if;

  select id, name, email into v_member
  from public.platform_team_members
  where id = p_team_member_id and active;

  if not found then
    raise exception 'Team member not found or inactive: %', p_team_member_id;
  end if;

  update public.marketing_demo_requests
  set assigned_to = p_team_member_id, assigned_at = now(), status = 'assigned'
  where id = p_id
  returning name, school_name, email, phone, student_count, message into v_request;

  if not found then
    raise exception 'Demo request not found: %', p_id;
  end if;

  select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'platform_notification_webhook_secret';

  perform net.http_post(
    url := v_project_url || '/functions/v1/notify-platform-admin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(v_webhook_secret, '')
    ),
    body := jsonb_build_object(
      'kind', 'demo_request_assigned',
      'assignee_name', v_member.name,
      'assignee_email', v_member.email,
      'name', v_request.name,
      'school_name', v_request.school_name,
      'email', v_request.email,
      'phone', v_request.phone,
      'student_count', v_request.student_count,
      'message', v_request.message,
      'demo_request_id', p_id
    )
  );
end;
$$;

revoke all on function public.admin_assign_demo_request(uuid, uuid) from public;
grant execute on function public.admin_assign_demo_request(uuid, uuid) to authenticated;
