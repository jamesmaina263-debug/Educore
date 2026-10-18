-- Manual demo booking on sales leads (Growth Engine, Phase 2 item C).
--
-- A person on the sales team records that a demo is booked for a lead (when, how, who runs it), then marks it
-- held, no-show or cancelled afterwards. NO calendar, no invitation, no message is sent: this is a record of
-- what a person arranged themselves. It exists so "demo_booked" in the pipeline means a real, dated demo.
--
-- Additive: one new table, four new functions. Nothing existing is altered, dropped or backfilled.
-- Needs 20260924130000_sales_pipeline_crm.sql (sales_leads, activities, admin_set_sales_lead_stage).
--
-- Rules enforced here (not only in the UI):
--  * One SCHEDULED demo per lead at a time (partial unique index); reschedule or cancel it first.
--  * Only an open lead (not paid / lost) can have a demo booked, and only for a future time.
--  * Booking moves the stage to demo_booked ONLY from new / visited / decision_maker_met. It never moves a
--    lead backwards (a lead already at demo_done, pilot or paid keeps its stage).
--  * Marking held moves the stage to demo_done from new..demo_booked only; never backwards, never on a lost lead.
--  * no_show and cancelled never change the stage (stage history is not tracked, so there is no safe "previous
--    stage" to return to); a no-show brings the follow-up date forward to today (East Africa Time).
--  * A demo can only be closed out from 'scheduled', and held / no_show only after its start time. Repeating the
--    same closing action is a no-op (no duplicate activity); a different one raises.
--  * Every change writes one 'demo' row to sales_lead_activities. Stage moves reuse admin_set_sales_lead_stage()
--    so they are logged exactly like manual stage changes.
--
-- Access model matches sales_leads: super admin read only; every write is a SECURITY DEFINER function that
-- checks auth_is_super_admin() itself; no client role gets insert/update/delete.

create table if not exists public.sales_lead_demos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  scheduled_for timestamptz not null,
  mode text not null check (mode in ('in_person', 'video_call', 'phone')),
  -- Where, or the meeting link. Not a secret: never put passcodes here.
  location_note text check (location_note is null or char_length(location_note) <= 300),
  host_id uuid references public.platform_team_members(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'held', 'no_show', 'cancelled')),
  outcome_note text check (outcome_note is null or char_length(outcome_note) <= 500),
  status_changed_at timestamptz not null default now()
);

comment on table public.sales_lead_demos is
  'Manually recorded demos for sales leads (when, how, who, outcome). Records what a person arranged; nothing is sent and no calendar is involved. Super-admin read only; writes via admin_book_sales_lead_demo() / admin_reschedule_sales_lead_demo() / admin_set_sales_lead_demo_status(). Deleted with the lead.';

create unique index if not exists sales_lead_demos_one_scheduled_idx
  on public.sales_lead_demos (lead_id) where status = 'scheduled';
create index if not exists sales_lead_demos_lead_idx on public.sales_lead_demos (lead_id, scheduled_for desc);
create index if not exists sales_lead_demos_upcoming_idx on public.sales_lead_demos (scheduled_for) where status = 'scheduled';
create index if not exists sales_lead_demos_host_idx on public.sales_lead_demos (host_id) where host_id is not null;

alter table public.sales_lead_demos enable row level security;

revoke all on public.sales_lead_demos from anon, authenticated;
grant select on public.sales_lead_demos to authenticated;

drop policy if exists "sales_lead_demos_select" on public.sales_lead_demos;
create policy "sales_lead_demos_select"
  on public.sales_lead_demos
  for select
  to authenticated
  using (auth_is_super_admin());

-- Internal: a Nairobi (EAT, UTC+3, no DST) calendar date for an instant.
create or replace function public._eat_date(p_at timestamptz)
returns date
language sql
immutable
set search_path to 'public'
as $$ select (p_at at time zone 'Africa/Nairobi')::date $$;

revoke all on function public._eat_date(timestamptz) from public, anon, authenticated;

-- ============================================================
-- Book a demo. Returns the demo id.
-- ============================================================
create or replace function public.admin_book_sales_lead_demo(
  p_lead_id uuid,
  p_scheduled_for timestamptz,
  p_mode text,
  p_location_note text default null,
  p_host_id uuid default null,
  p_performed_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  l public.sales_leads%rowtype;
  v_id uuid;
  v_day date;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;
  if p_mode not in ('in_person', 'video_call', 'phone') then
    raise exception 'Mode must be in_person, video_call or phone.';
  end if;
  if p_scheduled_for is null or p_scheduled_for <= now() then
    raise exception 'Pick a date and time in the future.';
  end if;
  if p_location_note is not null and char_length(btrim(p_location_note)) > 300 then
    raise exception 'Location / link is too long (max 300 characters).';
  end if;

  select * into l from public.sales_leads where id = p_lead_id for update;
  if not found then
    raise exception 'Sales lead not found.';
  end if;
  if l.stage in ('paid', 'lost') then
    raise exception 'A demo cannot be booked for a paid or lost lead.';
  end if;
  if p_host_id is not null and not exists (select 1 from public.platform_team_members where id = p_host_id) then
    raise exception 'Team member not found.';
  end if;
  if exists (select 1 from public.sales_lead_demos where lead_id = p_lead_id and status = 'scheduled') then
    raise exception 'This lead already has a scheduled demo. Reschedule or cancel it first.';
  end if;

  insert into public.sales_lead_demos (lead_id, scheduled_for, mode, location_note, host_id)
  values (p_lead_id, p_scheduled_for, p_mode, nullif(btrim(p_location_note), ''), p_host_id)
  returning id into v_id;

  -- Never backwards: only leads that have not reached a demo yet move to demo_booked.
  if l.stage in ('new', 'visited', 'decision_maker_met') then
    perform public.admin_set_sales_lead_stage(p_lead_id, 'demo_booked', null, p_performed_by);
  end if;

  -- Bring the follow-up date forward to the demo day if it is empty or later (never push an earlier one back).
  v_day := public._eat_date(p_scheduled_for);
  update public.sales_leads
     set next_follow_up_on = case when next_follow_up_on is null or next_follow_up_on > v_day then v_day else next_follow_up_on end,
         updated_at = now()
   where id = p_lead_id;

  insert into public.sales_lead_activities (lead_id, activity_type, performed_by, summary)
  values (p_lead_id, 'demo', p_performed_by,
          'Demo booked for ' || to_char(p_scheduled_for at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI') || ' EAT ('
          || replace(p_mode, '_', ' ') || ')');

  return v_id;
end;
$$;

revoke all on function public.admin_book_sales_lead_demo(uuid, timestamptz, text, text, uuid, uuid) from public, anon;
grant execute on function public.admin_book_sales_lead_demo(uuid, timestamptz, text, text, uuid, uuid) to authenticated;

-- ============================================================
-- Reschedule a scheduled demo.
-- ============================================================
create or replace function public.admin_reschedule_sales_lead_demo(
  p_demo_id uuid,
  p_scheduled_for timestamptz,
  p_performed_by uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.sales_lead_demos%rowtype;
  v_day date;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;
  if p_scheduled_for is null or p_scheduled_for <= now() then
    raise exception 'Pick a date and time in the future.';
  end if;

  select * into d from public.sales_lead_demos where id = p_demo_id for update;
  if not found then
    raise exception 'Demo not found.';
  end if;
  if d.status <> 'scheduled' then
    raise exception 'Only a scheduled demo can be rescheduled.';
  end if;
  if d.scheduled_for = p_scheduled_for then
    return;
  end if;

  update public.sales_lead_demos set scheduled_for = p_scheduled_for, updated_at = now() where id = p_demo_id;

  v_day := public._eat_date(p_scheduled_for);
  update public.sales_leads
     set next_follow_up_on = case when next_follow_up_on is null or next_follow_up_on > v_day then v_day else next_follow_up_on end,
         updated_at = now()
   where id = d.lead_id;

  insert into public.sales_lead_activities (lead_id, activity_type, performed_by, summary)
  values (d.lead_id, 'demo', p_performed_by,
          'Demo rescheduled from ' || to_char(d.scheduled_for at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI')
          || ' to ' || to_char(p_scheduled_for at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI') || ' EAT');
end;
$$;

revoke all on function public.admin_reschedule_sales_lead_demo(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.admin_reschedule_sales_lead_demo(uuid, timestamptz, uuid) to authenticated;

-- ============================================================
-- Close out a scheduled demo: held, no_show or cancelled.
-- ============================================================
create or replace function public.admin_set_sales_lead_demo_status(
  p_demo_id uuid,
  p_status text,
  p_outcome_note text default null,
  p_performed_by uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.sales_lead_demos%rowtype;
  l_stage text;
  v_note text := nullif(btrim(p_outcome_note), '');
  v_label text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;
  if p_status not in ('held', 'no_show', 'cancelled') then
    raise exception 'Status must be held, no_show or cancelled.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Note is too long (max 500 characters).';
  end if;

  select * into d from public.sales_lead_demos where id = p_demo_id for update;
  if not found then
    raise exception 'Demo not found.';
  end if;

  if d.status = p_status then
    return; -- same action again: nothing to do, no duplicate activity
  end if;
  if d.status <> 'scheduled' then
    raise exception 'This demo is already marked %.', replace(d.status, '_', ' ');
  end if;
  if p_status in ('held', 'no_show') and d.scheduled_for > now() then
    raise exception 'This demo has not happened yet.';
  end if;

  update public.sales_lead_demos
     set status = p_status, outcome_note = v_note, status_changed_at = now(), updated_at = now()
   where id = p_demo_id;

  select stage into l_stage from public.sales_leads where id = d.lead_id for update;

  if p_status = 'held' and l_stage in ('new', 'visited', 'decision_maker_met', 'demo_booked') then
    perform public.admin_set_sales_lead_stage(d.lead_id, 'demo_done', null, p_performed_by);
  end if;

  if p_status = 'no_show' then
    update public.sales_leads
       set next_follow_up_on = case when next_follow_up_on is null or next_follow_up_on > public._eat_date(now()) then public._eat_date(now()) else next_follow_up_on end,
           updated_at = now()
     where id = d.lead_id;
  end if;

  v_label := case p_status when 'held' then 'held' when 'no_show' then 'no-show' else 'cancelled' end;
  insert into public.sales_lead_activities (lead_id, activity_type, performed_by, summary)
  values (d.lead_id, 'demo', p_performed_by,
          'Demo of ' || to_char(d.scheduled_for at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI') || ' EAT: ' || v_label
          || coalesce(' (' || v_note || ')', ''));
end;
$$;

revoke all on function public.admin_set_sales_lead_demo_status(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_set_sales_lead_demo_status(uuid, text, text, uuid) to authenticated;
