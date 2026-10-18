-- Trial check-in log (Growth Engine, Phase 2 item A).
--
-- Records that a person on the platform team checked in with a TRIAL school (who, when, how, outcome), so
-- the Trial follow-up page can show it and nobody is chased twice. Manual and self-reported: nothing here
-- sends a message, changes a subscription, or proves delivery.
--
-- Additive only: one new table and one new function. Nothing existing is altered, dropped or backfilled.
--
-- Why a new table (and not sales_lead_activities): that log requires a sales lead, and most trial schools
-- signed up themselves and have no lead record. School-level facts only: no learner data.
--
-- Access model matches outbound_contact_log: super admin can read; nobody gets insert/update/delete on the
-- table directly; the write is a SECURITY DEFINER function that checks auth_is_super_admin() itself.

create table if not exists public.trial_checkins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  school_id uuid not null references public.schools(id) on delete cascade,
  channel text not null check (channel in ('call', 'whatsapp', 'email', 'visit', 'other')),
  outcome text not null check (outcome in (
    'reached_interested', 'reached_needs_time', 'reached_not_interested',
    'no_answer', 'message_left', 'asked_to_stop'
  )),
  performed_by uuid references public.platform_team_members(id) on delete set null,
  note text check (note is null or char_length(note) <= 500)
);

comment on table public.trial_checkins is
  'Manual log of platform-team check-ins with trial schools (who, when, channel, outcome). Self-reported, not proof of delivery. asked_to_stop means the school asked not to be contacted: the follow-up page stops suggesting them. Super-admin read only; writes via admin_log_trial_checkin(). Deleted with the school.';

create index if not exists trial_checkins_school_idx on public.trial_checkins (school_id, created_at desc);
create index if not exists trial_checkins_performed_by_idx on public.trial_checkins (performed_by) where performed_by is not null;

alter table public.trial_checkins enable row level security;

revoke all on public.trial_checkins from anon, authenticated;
grant select on public.trial_checkins to authenticated;

drop policy if exists "trial_checkins_select" on public.trial_checkins;
create policy "trial_checkins_select"
  on public.trial_checkins
  for select
  to authenticated
  using (auth_is_super_admin());

-- Log a check-in. Returns the new row id. The school must exist and have a subscription row (i.e. be a
-- trial or a recently ended one), so the log cannot collect entries for arbitrary schools.
create or replace function public.admin_log_trial_checkin(
  p_school_id uuid,
  p_channel text,
  p_outcome text,
  p_performed_by uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to log trial check-ins.';
  end if;
  if p_channel not in ('call', 'whatsapp', 'email', 'visit', 'other') then
    raise exception 'Unknown channel.';
  end if;
  if p_outcome not in ('reached_interested', 'reached_needs_time', 'reached_not_interested', 'no_answer', 'message_left', 'asked_to_stop') then
    raise exception 'Unknown outcome.';
  end if;
  if p_note is not null and char_length(btrim(p_note)) > 500 then
    raise exception 'Note is too long (max 500 characters).';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found.';
  end if;
  if not exists (select 1 from public.school_subscriptions where school_id = p_school_id) then
    raise exception 'This school has no trial or subscription to follow up.';
  end if;
  if p_performed_by is not null and not exists (select 1 from public.platform_team_members where id = p_performed_by) then
    raise exception 'Team member not found.';
  end if;

  insert into public.trial_checkins (school_id, channel, outcome, performed_by, note)
  values (p_school_id, p_channel, p_outcome, p_performed_by, nullif(btrim(p_note), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_log_trial_checkin(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.admin_log_trial_checkin(uuid, text, text, uuid, text) to authenticated;
