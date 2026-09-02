-- ============================================================================
-- PA-14 (GTM Readiness Protocol): a fourth, distinct "completed" engagement
-- state, on top of the delivered/read/acknowledged states already tracked
-- (delivered = a announcement_recipients row exists at publish time; read =
-- read_at; acknowledged = acknowledged_at).
--
-- "Acknowledged" already means "the guardian confirmed they saw/understood
-- this notice" (acknowledge_announcement). That is available for every
-- urgency. "Completed" is a step beyond that: the guardian confirms they
-- actually carried out the requested action -- so it is only meaningful for
-- urgency = 'action_required'. Calling it on a normal/urgent announcement is
-- a usage error (there is no action to complete), not a silent no-op.
--
-- Mirrors the existing mark_announcement_read / acknowledge_announcement
-- pattern: guardian-self-report, SECURITY DEFINER, idempotent on repeat
-- calls, blocked once the announcement is withdrawn.
-- ============================================================================

alter table public.announcement_recipients
  add column if not exists completed_at timestamptz;

comment on column public.announcement_recipients.completed_at is
  'PA-14: guardian confirms the required action itself was carried out, not just acknowledged. Only settable for urgency = action_required announcements.';

create or replace function public.complete_announcement_action(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_urgency text;
  v_status text;
begin
  if v_caller is null then
    raise exception 'no active school session';
  end if;

  if not exists (
    select 1 from public.announcement_recipients
    where announcement_id = p_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this announcement';
  end if;

  select urgency, status into v_urgency, v_status
  from public.announcements
  where id = p_id;

  if v_status is null then
    raise exception 'announcement not found';
  end if;
  if v_status = 'withdrawn' then
    raise exception 'this announcement has been withdrawn';
  end if;
  if v_urgency <> 'action_required' then
    raise exception 'only an action-required announcement can be marked complete';
  end if;

  update public.announcement_recipients
  set read_at = coalesce(read_at, now()),
      acknowledged_at = coalesce(acknowledged_at, now()),
      completed_at = coalesce(completed_at, now())
  where announcement_id = p_id and guardian_user_id = v_caller;
end;
$$;

revoke all on function public.complete_announcement_action(uuid) from public, anon;
grant execute on function public.complete_announcement_action(uuid) to authenticated;
