-- School Onboarding & Engagement Monitor (database half).
--
-- Gives the platform team one place to see where every newly registered school is in onboarding, which
-- ones need a person to help, and which are using the product. Statuses and progress are COMPUTED at read
-- time from records EduCore already keeps (no stored status column that can go stale), so they always
-- reflect reality. A scheduled job (src/app/api/cron/onboarding-monitor) only raises alerts and, if a super
-- admin has switched it on, sends two service emails.
--
-- What it reuses (nothing is duplicated):
--   * school_users.password_changed_at / must_change_password -- already stamped by the change-password
--     server action only after supabase.auth.updateUser() succeeds. This is the password signal.
--   * auth.users.email_confirmed_at / last_sign_in_at and school_users.last_seen_at -- email verified and
--     real app use (a school owner who sets a password from the emailed link is signed in without ever
--     visiting /login, so last_seen_at has to count as login evidence).
--   * students, classes, academic_years, fee_structures, school_users -- setup milestones are counted live.
--   * trial_nudges + email_campaigns + marketing_email_suppressions + trial_checkins -- the existing
--     approval queue, safeguards and send path. Every automatic email goes through the same checks
--     (_trial_nudge_problem / _trial_nudge_content_problem: suppression list, asked_to_stop, 3-day and daily
--     caps, demo/qa exclusion, owner-only recipient, educoreafrica.com links only).
--
-- What it adds (all additive; no existing table is altered except one nullable column on trial_nudges):
--   onboarding_settings, onboarding_milestone_config, onboarding_email_templates, school_onboarding_events,
--   onboarding_followups, onboarding_audit_log, school_onboarding_notes, trial_nudges.auto_rule.
--
-- Human control (by design):
--   * Automatic EMAIL is limited to two service templates: a password reminder and login guidance.
--   * Everything else only creates a dashboard alert for the team. Nothing is sent by WhatsApp.
--   * Automatic sending is OFF by default. It runs only when a super admin has (a) approved the exact
--     template text (approval is bound to a hash; changing a template voids it), (b) switched the monitor's
--     automation on, and (c) the existing trial-nudge sending switch is on. It only ever applies to schools
--     registered after automation_start_at (set to the moment of this migration), so live and existing
--     schools are never emailed.
--   * Before each send the state is re-verified: a password reminder is never sent once the password has
--     changed, and login guidance is never sent once the administrator is in the app.
--   * Every alert, approval, attempt and delivery is written to onboarding_audit_log.
--
-- Access: every table is RLS-locked with super-admin-only SELECT; all writes go through SECURITY DEFINER
-- functions that check auth_is_super_admin() or are executable by service_role only. No passwords or reset
-- tokens are stored anywhere in this feature. Safe to run twice.

-- ============================================================
-- Settings (single row)
-- ============================================================
create table if not exists public.onboarding_settings (
  id boolean primary key default true check (id),
  automation_enabled boolean not null default false,
  -- Automatic emails apply only to schools registered at or after this moment.
  automation_start_at timestamptz not null default now(),
  -- password_changed_at has been stamped since this date. A school created earlier has no reliable
  -- "never changed it" signal, so for those a null stamp is NOT treated as "password pending".
  password_tracking_started_at timestamptz not null default timestamptz '2026-08-19 00:00:00+00',
  password_reminder_hours integer not null default 24 check (password_reminder_hours between 1 and 720),
  password_flag_hours integer not null default 48 check (password_flag_hours between 1 and 720),
  login_guidance_hours integer not null default 24 check (login_guidance_hours between 1 and 720),
  no_setup_flag_hours integer not null default 48 check (no_setup_flag_hours between 1 and 720),
  inactive_days integer not null default 7 check (inactive_days between 1 and 180),
  templates_approved_hash text,
  templates_approved_by uuid references public.platform_team_members(id) on delete set null,
  templates_approved_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.onboarding_settings is
  'Single row. Thresholds for the onboarding rules and the master switch for automatic service emails (default OFF). Automatic email also needs approved templates and trial_nudge_settings.sending_enabled. Super-admin read only; written by admin_set_onboarding_settings().';

insert into public.onboarding_settings (id) values (true) on conflict (id) do nothing;

create index if not exists onboarding_settings_approved_by_idx on public.onboarding_settings (templates_approved_by) where templates_approved_by is not null;
create index if not exists onboarding_settings_updated_by_idx on public.onboarding_settings (updated_by) where updated_by is not null;

-- ============================================================
-- Milestones (configurable weight / required / enabled; the set of keys is fixed because each key maps to
-- a real record check in _onboarding_rows())
-- ============================================================
create table if not exists public.onboarding_milestone_config (
  key text primary key check (key in (
    'password_changed', 'email_verified', 'first_login', 'academic_year', 'classes', 'students', 'fee_structures', 'second_user'
  )),
  label text not null,
  grp text not null check (grp in ('account', 'setup')),
  weight integer not null default 1 check (weight between 1 and 10),
  required boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.onboarding_milestone_config is
  'Which milestones count toward onboarding progress, their weight, and which are required for "onboarding complete". grp=setup milestones are what separate LOGGED IN - NO SETUP from SETTING UP. Edited through admin_set_onboarding_milestone().';

insert into public.onboarding_milestone_config (key, label, grp, weight, required, enabled, sort_order) values
  ('password_changed', 'Password changed', 'account', 1, true,  true,  10),
  ('email_verified',   'Email verified',   'account', 1, false, true,  20),
  ('first_login',      'First login',      'account', 1, true,  true,  30),
  ('academic_year',    'Academic year configured', 'setup', 2, true, true, 40),
  ('classes',          'Classes created',  'setup',   2, true,  true,  50),
  ('students',         'Students added',   'setup',   2, true,  true,  60),
  ('fee_structures',   'Fee structure configured', 'setup', 2, true, true, 70),
  ('second_user',      'Second staff account added', 'setup', 1, false, false, 80)
on conflict (key) do nothing;

create index if not exists onboarding_milestone_config_updated_by_idx on public.onboarding_milestone_config (updated_by) where updated_by is not null;

-- ============================================================
-- Login events (login history; first/last login). Written only by record_school_login().
-- ============================================================
create table if not exists public.school_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid references public.school_users(id) on delete cascade,
  event_type text not null check (event_type in ('login')),
  occurred_at timestamptz not null default now(),
  -- One login per person per Nairobi day: replaying the call is harmless.
  dedupe_key text not null,
  unique (school_id, event_type, dedupe_key)
);

comment on table public.school_onboarding_events is
  'Successful sign-ins recorded by the login action (one per person per Nairobi day). Used for login history and first-login time. School-level facts only; no credentials of any kind.';

create index if not exists school_onboarding_events_school_idx on public.school_onboarding_events (school_id, occurred_at desc);
create index if not exists school_onboarding_events_user_idx on public.school_onboarding_events (school_user_id) where school_user_id is not null;

-- ============================================================
-- Email templates (the only two emails automation can ever send)
-- ============================================================
create table if not exists public.onboarding_email_templates (
  rule_key text primary key check (rule_key in ('password_reminder_email', 'login_guidance_email')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  updated_at timestamptz not null default now()
);

comment on table public.onboarding_email_templates is
  'Fixed service-email wording for the two automatic emails. A super admin approves the exact text (hash stored in onboarding_settings); any change to a template voids that approval and pauses automatic sending. Changed only by migration. Only {{name}} and {{school}} placeholders.';

insert into public.onboarding_email_templates (rule_key, subject, body) values
  ('password_reminder_email',
   'Finish setting up your EduCore account',
   E'Hello {{name}},\n\nThank you for registering {{school}} on EduCore. We noticed the password for your account has not been set yet, so you cannot sign in.\n\nPlease use the link in the set-password email we sent when you registered. If you cannot find it, you can request a new one at https://www.educoreafrica.com/forgot-password\n\nIf you need a hand, just reply to this email and our team will help you.\n\nThe EduCore team'),
  ('login_guidance_email',
   'Your EduCore account is ready to use',
   E'Hello {{name}},\n\nYour password for {{school}} on EduCore is set, and your account is ready. The next step is to sign in at https://www.educoreafrica.com/login and begin setting up your school: your academic year, classes, students and fee structure.\n\nIf you would like help getting started, reply to this email and our team will guide you.\n\nThe EduCore team')
on conflict (rule_key) do nothing;

-- ============================================================
-- Follow-ups (dashboard alerts and email records) and the audit trail
-- ============================================================
create table if not exists public.onboarding_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  school_id uuid not null references public.schools(id) on delete cascade,
  rule_key text not null check (rule_key in (
    'password_reminder_email', 'password_pending_48h', 'login_guidance_email', 'no_setup_48h', 'inactive_7d',
    'manual_password_reminder', 'manual_login_guidance'
  )),
  kind text not null check (kind in ('alert', 'email')),
  status text not null check (status in ('open', 'resolved', 'dismissed', 'pending_approval', 'queued', 'sent', 'failed', 'skipped')),
  detail jsonb not null default '{}'::jsonb,
  nudge_id uuid references public.trial_nudges(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.platform_team_members(id) on delete set null,
  -- Idempotency. Alerts: school:rule while the condition holds (released when it clears, so a later
  -- recurrence can alert again). Automatic emails: school:rule forever, so the same condition can never
  -- send twice. Manual follow-ups leave it null (the trial-nudge 3-day cap limits those).
  dedupe_key text unique
);

comment on table public.onboarding_followups is
  'The follow-up queue: dashboard alerts (kind=alert) and email records (kind=email, automatic or manual). One automatic email per school per rule, ever. Super-admin read only.';

create index if not exists onboarding_followups_school_idx on public.onboarding_followups (school_id, created_at desc);
create index if not exists onboarding_followups_open_idx on public.onboarding_followups (status, created_at desc) where status in ('open', 'pending_approval', 'queued');
create index if not exists onboarding_followups_nudge_idx on public.onboarding_followups (nudge_id) where nudge_id is not null;
create index if not exists onboarding_followups_resolved_by_idx on public.onboarding_followups (resolved_by) where resolved_by is not null;

create table if not exists public.onboarding_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- No foreign keys on purpose: the trail must survive deleting a school or a message.
  school_id uuid,
  followup_id uuid,
  nudge_id uuid,
  event text not null check (event in (
    'alert_generated', 'alert_resolved', 'alert_dismissed', 'email_approved', 'email_queued', 'email_skipped',
    'delivery_attempted', 'delivery_succeeded', 'delivery_failed', 'send_cancelled_safety',
    'manual_followup_proposed', 'note_added', 'settings_changed', 'templates_approved', 'milestone_changed'
  )),
  actor text not null default 'system' check (actor in ('system', 'team_member')),
  actor_member_id uuid,
  detail jsonb not null default '{}'::jsonb
);

comment on table public.onboarding_audit_log is
  'Append-only record of every alert generated, approval, attempted delivery and successful delivery. Codes and ids only: never an email address, subject, body, password or token. Written only by SECURITY DEFINER functions; super-admin read only.';

create index if not exists onboarding_audit_log_school_idx on public.onboarding_audit_log (school_id, created_at desc);
create index if not exists onboarding_audit_log_event_idx on public.onboarding_audit_log (event, created_at desc);

create table if not exists public.school_onboarding_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null check (kind in ('call', 'demo', 'challenge', 'other')),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.school_onboarding_notes is
  'Admin notes about a school''s onboarding: phone conversations, demonstrations, challenges the school reported. Super-admin read only; written by admin_add_onboarding_note().';

create index if not exists school_onboarding_notes_school_idx on public.school_onboarding_notes (school_id, created_at desc);
create index if not exists school_onboarding_notes_created_by_idx on public.school_onboarding_notes (created_by) where created_by is not null;

-- Marks a trial_nudges row that automation created from an approved onboarding template (null = a person's).
alter table public.trial_nudges add column if not exists auto_rule text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trial_nudges_auto_rule_check') then
    alter table public.trial_nudges
      add constraint trial_nudges_auto_rule_check
      check (auto_rule is null or auto_rule in ('password_reminder_email', 'login_guidance_email'));
  end if;
end $$;
comment on column public.trial_nudges.auto_rule is
  'Set only when the onboarding monitor created and queued this message from a super-admin-approved template. Null for messages a person proposed.';

-- ============================================================
-- Access: super-admin read only; no direct writes by any client
-- ============================================================
alter table public.onboarding_settings enable row level security;
alter table public.onboarding_milestone_config enable row level security;
alter table public.school_onboarding_events enable row level security;
alter table public.onboarding_email_templates enable row level security;
alter table public.onboarding_followups enable row level security;
alter table public.onboarding_audit_log enable row level security;
alter table public.school_onboarding_notes enable row level security;

revoke all on public.onboarding_settings from anon, authenticated;
revoke all on public.onboarding_milestone_config from anon, authenticated;
revoke all on public.school_onboarding_events from anon, authenticated;
revoke all on public.onboarding_email_templates from anon, authenticated;
revoke all on public.onboarding_followups from anon, authenticated;
revoke all on public.onboarding_audit_log from anon, authenticated;
revoke all on public.school_onboarding_notes from anon, authenticated;

grant select on public.onboarding_settings to authenticated;
grant select on public.onboarding_milestone_config to authenticated;
grant select on public.school_onboarding_events to authenticated;
grant select on public.onboarding_email_templates to authenticated;
grant select on public.onboarding_followups to authenticated;
grant select on public.onboarding_audit_log to authenticated;
grant select on public.school_onboarding_notes to authenticated;

drop policy if exists "onboarding_settings_select" on public.onboarding_settings;
create policy "onboarding_settings_select" on public.onboarding_settings for select to authenticated using (auth_is_super_admin());
drop policy if exists "onboarding_milestone_config_select" on public.onboarding_milestone_config;
create policy "onboarding_milestone_config_select" on public.onboarding_milestone_config for select to authenticated using (auth_is_super_admin());
drop policy if exists "school_onboarding_events_select" on public.school_onboarding_events;
create policy "school_onboarding_events_select" on public.school_onboarding_events for select to authenticated using (auth_is_super_admin());
drop policy if exists "onboarding_email_templates_select" on public.onboarding_email_templates;
create policy "onboarding_email_templates_select" on public.onboarding_email_templates for select to authenticated using (auth_is_super_admin());
drop policy if exists "onboarding_followups_select" on public.onboarding_followups;
create policy "onboarding_followups_select" on public.onboarding_followups for select to authenticated using (auth_is_super_admin());
drop policy if exists "onboarding_audit_log_select" on public.onboarding_audit_log;
create policy "onboarding_audit_log_select" on public.onboarding_audit_log for select to authenticated using (auth_is_super_admin());
drop policy if exists "school_onboarding_notes_select" on public.school_onboarding_notes;
create policy "school_onboarding_notes_select" on public.school_onboarding_notes for select to authenticated using (auth_is_super_admin());

-- ============================================================
-- Internal helpers (not callable by clients)
-- ============================================================

create or replace function public._onboarding_audit(
  p_school uuid, p_followup uuid, p_nudge uuid, p_event text, p_member uuid default null, p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.onboarding_audit_log (school_id, followup_id, nudge_id, event, actor, actor_member_id, detail)
  values (p_school, p_followup, p_nudge, p_event,
          case when p_member is null then 'system' else 'team_member' end, p_member, coalesce(p_detail, '{}'::jsonb));
$$;

-- Hash of both templates; an approval is valid only while this still equals the approved hash.
create or replace function public._onboarding_templates_hash()
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(encode(sha256(convert_to(
    string_agg(t.rule_key || E'\x1f' || btrim(t.subject) || E'\x1f' || btrim(t.body), E'\x1e' order by t.rule_key),
    'UTF8')), 'hex'), '')
  from public.onboarding_email_templates t
$$;

-- True only when a super admin has approved the current templates, switched automation on, AND the existing
-- trial-nudge sending switch is on.
create or replace function public._onboarding_automation_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select s.automation_enabled
       and s.templates_approved_hash is not null
       and s.templates_approved_hash = public._onboarding_templates_hash()
       and coalesce((select n.sending_enabled from public.trial_nudge_settings n where n.id), false)
    from public.onboarding_settings s where s.id
  ), false)
$$;

-- ------------------------------------------------------------
-- The single source of truth: one row per school with every fact, milestone, progress figure and status.
-- Excludes the demo school and qa-* schools (same convention as the trial funnel and trial nudges).
-- ------------------------------------------------------------
create or replace function public._onboarding_rows()
returns table (
  school_id uuid,
  school_name text,
  school_slug text,
  school_status text,
  registered_at timestamptz,
  admin_user_id uuid,
  admin_name text,
  admin_email text,
  password_changed_at timestamptz,
  email_verified_at timestamptz,
  first_login_at timestamptz,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  student_count integer,
  class_count integer,
  academic_year_count integer,
  fee_structure_count integer,
  user_count integer,
  milestones jsonb,
  progress_pct integer,
  setup_started boolean,
  required_complete boolean,
  last_activity_at timestamptz,
  days_since_activity integer,
  status text,
  priority text
)
language sql
stable
security definer
set search_path to 'public'
as $$
with st as (
  select * from public.onboarding_settings where id
),
base as (
  select
    s.id as sid, s.name as sname, s.slug as sslug, s.status as sstatus, s.created_at as created_at,
    o.uid, o.full_name, o.email, o.pwd_at, o.must_change, o.o_seen,
    au.email_confirmed_at, au.last_sign_in_at,
    (select max(x.last_seen_at) from public.school_users x where x.school_id = s.id) as school_seen,
    (select count(*) from public.students x where x.school_id = s.id)::integer as stu,
    (select count(*) from public.classes x where x.school_id = s.id)::integer as cls,
    (select count(*) from public.academic_years x where x.school_id = s.id)::integer as yrs,
    (select count(*) from public.fee_structures x where x.school_id = s.id)::integer as fees,
    (select count(*) from public.school_users x where x.school_id = s.id and x.status = 'active')::integer as usr,
    (select min(e.occurred_at) from public.school_onboarding_events e where e.school_id = s.id and e.event_type = 'login' and e.school_user_id = o.uid) as ev_first,
    (select max(e.occurred_at) from public.school_onboarding_events e where e.school_id = s.id and e.event_type = 'login' and e.school_user_id = o.uid) as ev_last,
    greatest(
      (select max(x.created_at) from public.students x where x.school_id = s.id),
      (select max(x.created_at) from public.classes x where x.school_id = s.id),
      (select max(x.created_at) from public.academic_years x where x.school_id = s.id),
      (select max(x.created_at) from public.fee_structures x where x.school_id = s.id)
    ) as setup_ts
  from public.schools s
  left join lateral (
    select su.id as uid, su.auth_user_id, su.full_name, lower(su.email) as email,
           su.password_changed_at as pwd_at, su.must_change_password as must_change, su.last_seen_at as o_seen
      from public.school_users su
      join public.roles r on r.id = su.role_id and r.name = 'school_owner'
     where su.school_id = s.id
     order by (su.status = 'active') desc, su.created_at, su.id
     limit 1
  ) o on true
  left join auth.users au on au.id = (
    select su2.auth_user_id from public.school_users su2 where su2.id = o.uid
  )
  where s.slug <> 'demo-academy' and s.slug not like 'qa-%'
),
c1 as (
  select b.*, st.password_tracking_started_at as pts,
    -- Password changed: stamped by the change-password action. Schools created before stamping began have no
    -- reliable "never changed" signal, so for them an owner who is not forced to change it and has signed in
    -- counts as done.
    (b.pwd_at is not null
     or (b.created_at < st.password_tracking_started_at and not coalesce(b.must_change, false) and b.last_sign_in_at is not null)) as pw_done
  from base b cross join st
),
c2 as (
  select c1.*,
    -- Logged in: a recorded login, or real app use / a sign-in after the password was set. (An owner who sets a
    -- password from the emailed link is already signed in, so app use counts as a login.)
    (c1.pw_done and (
       c1.ev_first is not null
       or (c1.pwd_at is not null and (coalesce(c1.o_seen >= c1.pwd_at, false) or coalesce(c1.last_sign_in_at > c1.pwd_at, false)))
       or (c1.pwd_at is null and c1.last_sign_in_at is not null)
    )) as login_done
  from c1
),
c3 as (
  select c2.*,
    jsonb_build_object(
      'password_changed', c2.pw_done,
      'email_verified', c2.email_confirmed_at is not null,
      'first_login', c2.login_done,
      'academic_year', c2.yrs > 0,
      'classes', c2.cls > 0,
      'students', c2.stu > 0,
      'fee_structures', c2.fees > 0,
      'second_user', c2.usr >= 2
    ) as flags
  from c2
),
c4 as (
  select c3.*, m.milestones, m.progress, m.req_ok, m.started,
    -- Meaningful activity: setting the school up, changing the password, or real use of the app by any of its
    -- people. A bare sign-in is not counted.
    greatest(c3.setup_ts, c3.school_seen, c3.pwd_at) as activity_at
  from c3
  cross join lateral (
    select
      coalesce(jsonb_object_agg(k.key, coalesce((c3.flags ->> k.key)::boolean, false)), '{}'::jsonb) as milestones,
      case when coalesce(sum(k.weight), 0) = 0 then 0
           else round(100.0 * coalesce(sum(k.weight) filter (where (c3.flags ->> k.key)::boolean), 0) / sum(k.weight))::integer end as progress,
      coalesce(bool_and(coalesce((c3.flags ->> k.key)::boolean, false)) filter (where k.required), false) as req_ok,
      coalesce(bool_or(coalesce((c3.flags ->> k.key)::boolean, false)) filter (where k.grp = 'setup'), false) as started
    from public.onboarding_milestone_config k
    where k.enabled
  ) m
),
c5 as (
  select c4.*, st.inactive_days, st.password_reminder_hours, st.password_flag_hours, st.login_guidance_hours, st.no_setup_flag_hours,
    case
      when not c4.pw_done then 'password_pending'
      when not c4.login_done then 'not_started'
      when coalesce(c4.activity_at, c4.created_at) < now() - make_interval(days => st.inactive_days) then 'inactive'
      when not c4.started then 'logged_in_no_setup'
      when c4.req_ok then 'complete'
      else 'setting_up'
    end as status_code,
    coalesce(c4.ev_first, case when c4.login_done then coalesce(c4.pwd_at, c4.last_sign_in_at) end) as first_login
  from c4 cross join st
)
select
  c5.sid, c5.sname, c5.sslug, c5.sstatus, c5.created_at,
  c5.uid, c5.full_name, c5.email,
  c5.pwd_at, c5.email_confirmed_at,
  c5.first_login,
  greatest(c5.last_sign_in_at, c5.ev_last),
  c5.school_seen,
  c5.stu, c5.cls, c5.yrs, c5.fees, c5.usr,
  c5.milestones, c5.progress, c5.started, c5.req_ok,
  c5.activity_at,
  floor(extract(epoch from (now() - coalesce(c5.activity_at, c5.created_at))) / 86400)::integer,
  c5.status_code,
  case c5.status_code
    when 'complete' then 'none'
    when 'inactive' then 'high'
    when 'password_pending' then
      case when c5.created_at <= now() - make_interval(hours => c5.password_flag_hours) then 'high'
           when c5.created_at <= now() - make_interval(hours => c5.password_reminder_hours) then 'medium'
           else 'low' end
    when 'not_started' then
      case when coalesce(c5.pwd_at, c5.created_at) <= now() - make_interval(hours => c5.no_setup_flag_hours) then 'high'
           when coalesce(c5.pwd_at, c5.created_at) <= now() - make_interval(hours => c5.login_guidance_hours) then 'medium'
           else 'low' end
    when 'logged_in_no_setup' then
      case when c5.first_login <= now() - make_interval(hours => c5.no_setup_flag_hours) then 'high' else 'low' end
    else
      case when floor(extract(epoch from (now() - coalesce(c5.activity_at, c5.created_at))) / 86400) >= 3 then 'medium' else 'low' end
  end
from c5
$$;

-- ------------------------------------------------------------
-- Queue ONE automatic email for one school through the existing trial-nudge pipeline. Re-verifies the school's
-- CURRENT state and every existing safeguard first. Returns 'queued' or a short reason code. Never raises for
-- a business reason; the caller isolates unexpected errors per school.
-- ------------------------------------------------------------
create or replace function public._onboarding_queue_email(p_school_id uuid, p_rule text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  t record;
  v_problem text;
  v_email text;
  v_name text;
  v_school text;
  v_hash text;
  v_followup uuid;
  v_campaign uuid;
  v_nudge uuid;
begin
  if p_rule not in ('password_reminder_email', 'login_guidance_email') then return 'unknown_rule'; end if;

  select * into r from public._onboarding_rows() x where x.school_id = p_school_id;
  if not found then return 'school_not_found'; end if;
  -- Safety: never remind about a password that has been changed; never guide a login that has happened.
  if p_rule = 'password_reminder_email' and r.status <> 'password_pending' then return 'condition_no_longer_applies'; end if;
  -- Extra caution for "never remind someone who already set a password": the password stamp is written by a
  -- best-effort step, so if the owner has signed in since registering but there is no stamp, the state is
  -- ambiguous. Do not email; the dashboard alert still covers it for a person to check.
  if p_rule = 'password_reminder_email' and r.password_changed_at is null and r.last_login_at is not null then
    return 'owner_signed_in_password_unconfirmed';
  end if;
  if p_rule = 'login_guidance_email' and r.status <> 'not_started' then return 'condition_no_longer_applies'; end if;

  select * into t from public.onboarding_email_templates where rule_key = p_rule;
  if not found then return 'no_template'; end if;

  v_problem := public._trial_nudge_content_problem('service', t.subject, t.body);
  if v_problem is not null then return 'content_refused'; end if;
  v_problem := public._trial_nudge_problem(p_school_id, 'service', null);
  if v_problem is not null then return 'blocked: ' || v_problem; end if;

  select e.email, e.name, e.school_name into v_email, v_name, v_school from public._trial_nudge_recipient(p_school_id) e;
  if v_email is null then return 'no_recipient'; end if;

  if (select count(*) from public.trial_nudges n
       where n.status in ('queued', 'sent') and coalesce(n.sent_at, n.queued_at) > now() - interval '24 hours') >= 30 then
    return 'daily_cap_reached';
  end if;

  v_hash := public._trial_nudge_hash(p_school_id, 'service', v_email, t.subject, t.body);

  insert into public.onboarding_followups (school_id, rule_key, kind, status, detail, dedupe_key)
  values (p_school_id, p_rule, 'email', 'queued',
          jsonb_build_object('automatic', true, 'template_hash', public._onboarding_templates_hash(), 'status_at_queue', r.status),
          p_school_id::text || ':' || p_rule)
  on conflict (dedupe_key) do nothing
  returning id into v_followup;
  if v_followup is null then return 'already_handled'; end if;

  insert into public.email_campaigns (subject, body, audience, created_by)
  values (left('Onboarding: ' || coalesce(v_school, 'school'), 200), t.body, 'school_owners', null)
  returning id into v_campaign;

  insert into public.email_campaign_recipients (campaign_id, school_id, school_name, recipient_name, email, custom_subject, custom_body)
  values (v_campaign, p_school_id, v_school, v_name, v_email, t.subject, t.body);

  insert into public.trial_nudges (
    school_id, kind, recipient_email, recipient_name, subject, body, payload_hash,
    status, reviewed_at, review_note, approved_hash, campaign_id, queued_at, auto_rule
  ) values (
    p_school_id, 'service', v_email, v_name, btrim(t.subject), btrim(t.body), v_hash,
    'queued', now(), 'Automatic: super-admin-approved onboarding template', v_hash, v_campaign, now(), p_rule
  ) returning id into v_nudge;

  update public.onboarding_followups set nudge_id = v_nudge, updated_at = now() where id = v_followup;

  perform public._onboarding_audit(p_school_id, v_followup, v_nudge, 'email_approved', null,
    jsonb_build_object('rule', p_rule, 'basis', 'approved_template'));
  perform public._onboarding_audit(p_school_id, v_followup, v_nudge, 'email_queued', null, jsonb_build_object('rule', p_rule));
  return 'queued';
end;
$$;

-- ============================================================
-- Scheduled evaluation (service role only): raise alerts, clear resolved ones, queue the two emails.
-- ============================================================
create or replace function public.onboarding_run_rules(p_queue_emails boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  st public.onboarding_settings%rowtype;
  x record;
  v_rule text;
  v_res text;
  v_alerts integer := 0;
  v_resolved integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_active boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('onboarding_run_rules', 0)) then
    return jsonb_build_object('skipped', 'another run is in progress');
  end if;

  select * into st from public.onboarding_settings where id;

  -- 1. Alerts for the team (no message is ever sent for these).
  for x in
    with rows as (select * from public._onboarding_rows())
    select r.school_id, a.rule_key, r.status
      from rows r
      cross join lateral (values
        ('password_pending_48h', r.status = 'password_pending' and r.registered_at <= now() - make_interval(hours => st.password_flag_hours)),
        ('no_setup_48h',         r.status = 'logged_in_no_setup' and r.first_login_at <= now() - make_interval(hours => st.no_setup_flag_hours)),
        ('inactive_7d',          r.status = 'inactive')
      ) as a(rule_key, applies)
     where a.applies
  loop
    declare v_id uuid;
    begin
      insert into public.onboarding_followups (school_id, rule_key, kind, status, detail, dedupe_key)
      values (x.school_id, x.rule_key, 'alert', 'open', jsonb_build_object('status', x.status), x.school_id::text || ':' || x.rule_key)
      on conflict (dedupe_key) do nothing
      returning id into v_id;
      if v_id is not null then
        v_alerts := v_alerts + 1;
        perform public._onboarding_audit(x.school_id, v_id, null, 'alert_generated', null, jsonb_build_object('rule', x.rule_key));
      end if;
    end;
  end loop;

  -- 2. Alerts whose condition has cleared: resolve (if still open) and release the key so a later recurrence can alert again.
  for x in
    select f.id, f.school_id, f.rule_key, f.status as fstatus, r.status as cur
      from public.onboarding_followups f
      left join public._onboarding_rows() r on r.school_id = f.school_id
     where f.kind = 'alert' and f.dedupe_key is not null
       and (r.school_id is null
            or (f.rule_key = 'password_pending_48h' and r.status <> 'password_pending')
            or (f.rule_key = 'no_setup_48h' and r.status <> 'logged_in_no_setup')
            or (f.rule_key = 'inactive_7d' and r.status <> 'inactive'))
  loop
    update public.onboarding_followups
       set status = case when x.fstatus = 'open' then 'resolved' else status end,
           resolved_at = coalesce(resolved_at, now()),
           dedupe_key = null, updated_at = now()
     where id = x.id;
    if x.fstatus = 'open' then
      v_resolved := v_resolved + 1;
      perform public._onboarding_audit(x.school_id, x.id, null, 'alert_resolved', null, jsonb_build_object('rule', x.rule_key, 'reason', 'condition_cleared'));
    end if;
  end loop;

  -- 3. Automatic service emails: only when a super admin has approved the templates and switched everything on,
  -- and only for schools registered since automation_start_at.
  -- p_queue_emails=false lets the caller run alerts only (e.g. when the send path is not configured), so
  -- nothing is queued that could not be sent and quietly use up the trial-nudge frequency caps.
  v_active := public._onboarding_automation_active() and coalesce(p_queue_emails, true);
  if v_active then
    for x in
      select r.school_id, r.status, r.registered_at, r.password_changed_at
        from public._onboarding_rows() r
       where r.registered_at >= st.automation_start_at
         and r.school_status = 'trial'
         and ((r.status = 'password_pending' and r.registered_at <= now() - make_interval(hours => st.password_reminder_hours))
           or (r.status = 'not_started' and coalesce(r.password_changed_at, r.registered_at) <= now() - make_interval(hours => st.login_guidance_hours)))
       order by r.registered_at
       limit 25
    loop
      v_rule := case when x.status = 'password_pending' then 'password_reminder_email' else 'login_guidance_email' end;
      if exists (select 1 from public.onboarding_followups f where f.dedupe_key = x.school_id::text || ':' || v_rule) then
        continue;
      end if;
      begin
        v_res := public._onboarding_queue_email(x.school_id, v_rule);
      exception when others then
        v_res := 'error';
      end;
      if v_res = 'queued' then
        v_queued := v_queued + 1;
      else
        v_skipped := v_skipped + 1;
        -- Log a given reason once a day per school and rule, not on every run.
        if not exists (
          select 1 from public.onboarding_audit_log a
           where a.school_id = x.school_id and a.event = 'email_skipped' and a.detail ->> 'rule' = v_rule
             and a.detail ->> 'reason' = v_res and a.created_at > now() - interval '24 hours'
        ) then
          perform public._onboarding_audit(x.school_id, null, null, 'email_skipped', null, jsonb_build_object('rule', v_rule, 'reason', left(v_res, 200)));
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('alerts_created', v_alerts, 'alerts_resolved', v_resolved, 'emails_queued', v_queued,
                            'emails_skipped', v_skipped, 'automation_active', v_active);
end;
$$;

-- Queued automatic emails waiting to be sent (the Edge Function sends them, re-verifying each first).
create or replace function public.onboarding_pending_sends(p_limit integer default 20)
returns table (nudge_id uuid, campaign_id uuid, school_id uuid, rule_key text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.campaign_id, n.school_id, n.auto_rule
    from public.trial_nudges n
   where n.auto_rule is not null and n.status = 'queued' and n.campaign_id is not null
   order by n.queued_at
   limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

-- Last check before an automatic email goes out. Returns {ok:true} and records the attempt, or {ok:false,reason}
-- after cancelling the message. Confirms the school is STILL in the state the email is about, that the automation
-- is still switched on with approved templates, and that every trial-nudge safeguard still passes.
create or replace function public.onboarding_recheck_before_send(p_nudge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  r record;
  v_followup uuid;
  v_reason text;
begin
  select * into n from public.trial_nudges where id = p_nudge_id and auto_rule is not null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_an_automatic_message'); end if;
  if n.status <> 'queued' then return jsonb_build_object('ok', false, 'reason', 'not_queued'); end if;
  select f.id into v_followup from public.onboarding_followups f where f.nudge_id = n.id limit 1;

  select * into r from public._onboarding_rows() x where x.school_id = n.school_id;
  if not found then
    v_reason := 'school_not_found';
  elsif not public._onboarding_automation_active() then
    v_reason := 'automation_switched_off_or_templates_not_approved';
  elsif n.auto_rule = 'password_reminder_email' and r.status <> 'password_pending' then
    v_reason := 'password_already_changed';
  elsif n.auto_rule = 'password_reminder_email' and r.password_changed_at is null and r.last_login_at is not null then
    v_reason := 'owner_signed_in_password_unconfirmed';
  elsif n.auto_rule = 'login_guidance_email' and r.status <> 'not_started' then
    v_reason := 'administrator_already_logged_in';
  elsif exists (select 1 from public.marketing_email_suppressions m where m.email = n.recipient_email) then
    v_reason := 'recipient_unsubscribed';
  else
    v_reason := public._trial_nudge_problem(n.school_id, 'service', n.id);
    if v_reason is not null then v_reason := 'blocked: ' || v_reason; end if;
  end if;

  if v_reason is not null then
    update public.trial_nudges set status = 'cancelled', error = left(v_reason, 500), updated_at = now() where id = n.id;
    update public.email_campaign_recipients set status = 'failed', error = left('Not sent: ' || v_reason, 500)
     where campaign_id = n.campaign_id and status = 'queued';
    update public.onboarding_followups set status = 'skipped', detail = detail || jsonb_build_object('skipped_reason', left(v_reason, 200)), updated_at = now()
     where id = v_followup;
    perform public._onboarding_audit(n.school_id, v_followup, n.id, 'send_cancelled_safety', null, jsonb_build_object('rule', n.auto_rule, 'reason', left(v_reason, 200)));
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  perform public._onboarding_audit(n.school_id, v_followup, n.id, 'delivery_attempted', null, jsonb_build_object('rule', n.auto_rule));
  return jsonb_build_object('ok', true);
end;
$$;

-- Records the outcome of an attempted automatic delivery.
create or replace function public.onboarding_record_delivery(p_nudge_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  v_followup uuid;
begin
  select * into n from public.trial_nudges where id = p_nudge_id and auto_rule is not null for update;
  if not found or n.status <> 'queued' then return; end if;
  select f.id into v_followup from public.onboarding_followups f where f.nudge_id = n.id limit 1;

  if p_ok then
    update public.trial_nudges set status = 'sent', sent_at = now(), updated_at = now() where id = n.id;
    update public.onboarding_followups set status = 'sent', updated_at = now() where id = v_followup;
    -- Same bookkeeping admin_finalize_trial_nudge does, so the Trial follow-up page does not suggest them again.
    insert into public.trial_checkins (school_id, channel, outcome, note)
    values (n.school_id, 'email', 'message_left', 'Automatic onboarding email sent (' || n.auto_rule || ')');
    perform public._onboarding_audit(n.school_id, v_followup, n.id, 'delivery_succeeded', null, jsonb_build_object('rule', n.auto_rule));
  else
    update public.trial_nudges set status = 'failed', error = left(coalesce(p_error, 'Send failed.'), 500), updated_at = now() where id = n.id;
    update public.onboarding_followups set status = 'failed', detail = detail || jsonb_build_object('error', left(coalesce(p_error, 'Send failed.'), 200)), updated_at = now() where id = v_followup;
    perform public._onboarding_audit(n.school_id, v_followup, n.id, 'delivery_failed', null, jsonb_build_object('rule', n.auto_rule, 'error', left(coalesce(p_error, 'Send failed.'), 200)));
  end if;
end;
$$;

-- Written by the login action after a successful sign-in. Takes no parameters: the person and school are
-- derived from the caller's own session, so it cannot be used to record anything about anyone else.
create or replace function public.record_school_login()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid;
  v_user uuid;
begin
  if auth.uid() is null then return; end if;
  select su.school_id, su.id into v_school, v_user
    from public.school_users su
   where su.auth_user_id = auth.uid() and su.status = 'active' and su.school_id is not null
   limit 1;
  if not found then return; end if;

  insert into public.school_onboarding_events (school_id, school_user_id, event_type, dedupe_key)
  values (v_school, v_user, 'login', v_user::text || ':' || to_char(now() at time zone 'Africa/Nairobi', 'YYYY-MM-DD'))
  on conflict (school_id, event_type, dedupe_key) do nothing;
end;
$$;

-- ============================================================
-- Super-admin reads
-- ============================================================
create or replace function public.admin_onboarding_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view school onboarding.';
  end if;
  select jsonb_build_object(
    'total', count(*)::integer,
    'password_pending', (count(*) filter (where status = 'password_pending'))::integer,
    'not_started', (count(*) filter (where status = 'not_started'))::integer,
    'logged_in_no_setup', (count(*) filter (where status = 'logged_in_no_setup'))::integer,
    'setting_up', (count(*) filter (where status = 'setting_up'))::integer,
    'complete', (count(*) filter (where status = 'complete'))::integer,
    'inactive', (count(*) filter (where status = 'inactive'))::integer
  ) into v from public._onboarding_rows();

  return v || jsonb_build_object(
    'open_alerts', (select count(*) from public.onboarding_followups where kind = 'alert' and status = 'open')::integer,
    'automation_active', public._onboarding_automation_active()
  );
end;
$$;

-- Paginated, filterable, sortable table. total_count is the number of rows matching the filters.
create or replace function public.admin_onboarding_list(
  p_status text default null,
  p_registered_from date default null,
  p_registered_to date default null,
  p_activity text default null,
  p_search text default null,
  p_sort text default 'newest',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  school_id uuid, school_name text, school_status text, registered_at timestamptz,
  admin_name text, admin_email text,
  password_changed_at timestamptz, first_login_at timestamptz, last_login_at timestamptz,
  student_count integer, class_count integer, progress_pct integer,
  status text, days_since_activity integer, priority text, total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_inactive integer;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view school onboarding.';
  end if;
  if p_status is not null and p_status not in ('password_pending', 'not_started', 'logged_in_no_setup', 'setting_up', 'complete', 'inactive') then
    raise exception 'Unknown status.';
  end if;
  if p_activity is not null and p_activity not in ('active', 'quiet') then
    raise exception 'Unknown activity filter.';
  end if;
  if p_sort not in ('newest', 'longest_inactive', 'lowest_progress') then
    raise exception 'Unknown sort.';
  end if;
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'Search is too long.';
  end if;
  select inactive_days into v_inactive from public.onboarding_settings where id;

  return query
  with f as (
    select r.*
      from public._onboarding_rows() r
     where (p_status is null or r.status = p_status)
       and (p_registered_from is null or r.registered_at >= p_registered_from::timestamp at time zone 'Africa/Nairobi')
       and (p_registered_to is null or r.registered_at < (p_registered_to + 1)::timestamp at time zone 'Africa/Nairobi')
       and (p_activity is null
            or (p_activity = 'active' and r.days_since_activity < v_inactive)
            or (p_activity = 'quiet' and r.days_since_activity >= v_inactive))
       and (v_search is null
            or r.school_name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or r.admin_name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or r.admin_email ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  )
  select f.school_id, f.school_name, f.school_status, f.registered_at,
         f.admin_name, f.admin_email,
         f.password_changed_at, f.first_login_at, f.last_login_at,
         f.student_count, f.class_count, f.progress_pct,
         f.status, f.days_since_activity, f.priority,
         count(*) over ()
    from f
   order by
     case when p_sort = 'longest_inactive' then f.days_since_activity end desc nulls last,
     case when p_sort = 'lowest_progress' then f.progress_pct end asc nulls last,
     f.registered_at desc,
     f.school_id
   limit v_limit offset v_offset;
end;
$$;

-- Everything the school detail page shows, in one call.
create or replace function public.admin_onboarding_school_detail(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  r record;
  v jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view school onboarding.';
  end if;
  select * into r from public._onboarding_rows() x where x.school_id = p_school_id;
  if not found then
    raise exception 'School not found.';
  end if;

  select jsonb_build_object(
    'school', to_jsonb(r),
    'milestone_config', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort_order) from public.onboarding_milestone_config k), '[]'::jsonb),
    'logins', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', e.occurred_at, 'person', su.full_name) order by e.occurred_at desc)
                          from (select * from public.school_onboarding_events where school_id = p_school_id order by occurred_at desc limit 50) e
                          left join public.school_users su on su.id = e.school_user_id), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc)
                             from (select id, created_at, rule_key, kind, status, resolved_at from public.onboarding_followups
                                    where school_id = p_school_id order by created_at desc limit 50) f), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
                            from (select id, created_at, kind, status, subject, auto_rule, queued_at, sent_at, error
                                    from public.trial_nudges where school_id = p_school_id order by created_at desc limit 20) n), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
                         from (select created_at, event, actor, detail from public.onboarding_audit_log
                                where school_id = p_school_id order by created_at desc limit 100) a), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', nt.id, 'created_at', nt.created_at, 'kind', nt.kind, 'note', nt.note, 'author', m.name) order by nt.created_at desc)
                         from (select * from public.school_onboarding_notes where school_id = p_school_id order by created_at desc limit 100) nt
                         left join public.platform_team_members m on m.id = nt.created_by), '[]'::jsonb),
    'registered_at', r.registered_at
  ) into v;
  return v;
end;
$$;

-- The follow-up queue: open alerts and manual follow-ups awaiting approval, with enough context to act.
create or replace function public.admin_onboarding_followup_queue(p_limit integer default 50, p_offset integer default 0)
returns table (
  followup_id uuid, created_at timestamptz, school_id uuid, school_name text, admin_name text, admin_email text,
  rule_key text, kind text, status text, onboarding_status text, priority text, total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view school onboarding.';
  end if;
  return query
  select f.id, f.created_at, f.school_id, r.school_name, r.admin_name, r.admin_email,
         f.rule_key, f.kind, f.status, r.status, r.priority, count(*) over ()
    from public.onboarding_followups f
    join public._onboarding_rows() r on r.school_id = f.school_id
   where f.status in ('open', 'pending_approval', 'queued', 'failed')
   order by (r.priority = 'high') desc, f.created_at
   limit greatest(1, least(coalesce(p_limit, 50), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_get_onboarding_config()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s public.onboarding_settings%rowtype;
  n public.trial_nudge_settings%rowtype;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view school onboarding.';
  end if;
  select * into s from public.onboarding_settings where id;
  select * into n from public.trial_nudge_settings where id;
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'templates_approved_by' - 'updated_by',
    'templates_hash', public._onboarding_templates_hash(),
    'templates_approved', s.templates_approved_hash is not null and s.templates_approved_hash = public._onboarding_templates_hash(),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('rule_key', t.rule_key, 'subject', t.subject, 'body', t.body) order by t.rule_key)
                             from public.onboarding_email_templates t), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort_order) from public.onboarding_milestone_config k), '[]'::jsonb),
    'trial_nudge_sending_enabled', coalesce(n.sending_enabled, false),
    'automation_active', public._onboarding_automation_active()
  );
end;
$$;

-- ============================================================
-- Super-admin writes
-- ============================================================
create or replace function public._onboarding_require_member(p_member uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_member is null or not exists (select 1 from public.platform_team_members where id = p_member) then
    raise exception 'Say who you are before making this change.';
  end if;
end;
$$;

create or replace function public.admin_set_onboarding_settings(
  p_automation_enabled boolean,
  p_automation_start_at timestamptz,
  p_password_reminder_hours integer,
  p_password_flag_hours integer,
  p_login_guidance_hours integer,
  p_no_setup_flag_hours integer,
  p_inactive_days integer,
  p_by uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  old public.onboarding_settings%rowtype;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  if p_automation_enabled is null or p_automation_start_at is null then
    raise exception 'The automation switch and start time are required.';
  end if;
  if p_password_reminder_hours not between 1 and 720 or p_password_flag_hours not between 1 and 720
     or p_login_guidance_hours not between 1 and 720 or p_no_setup_flag_hours not between 1 and 720 then
    raise exception 'Hour thresholds must be between 1 and 720.';
  end if;
  if p_inactive_days not between 1 and 180 then
    raise exception 'The inactivity period must be between 1 and 180 days.';
  end if;
  if p_automation_start_at > now() + interval '1 day' then
    raise exception 'The automation start time cannot be in the future.';
  end if;

  select * into old from public.onboarding_settings where id for update;
  update public.onboarding_settings
     set automation_enabled = p_automation_enabled, automation_start_at = p_automation_start_at,
         password_reminder_hours = p_password_reminder_hours, password_flag_hours = p_password_flag_hours,
         login_guidance_hours = p_login_guidance_hours, no_setup_flag_hours = p_no_setup_flag_hours,
         inactive_days = p_inactive_days, updated_at = now(), updated_by = p_by
   where id;

  perform public._onboarding_audit(null, null, null, 'settings_changed', p_by,
    jsonb_build_object('automation_enabled', p_automation_enabled, 'was_enabled', old.automation_enabled,
                       'start_moved', old.automation_start_at is distinct from p_automation_start_at));
end;
$$;

-- Approve the exact template text currently stored. The caller passes the hash they were shown.
create or replace function public.admin_approve_onboarding_templates(p_expected_hash text, p_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hash text := public._onboarding_templates_hash();
  t record;
  v_problem text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  if p_expected_hash is distinct from v_hash then
    raise exception 'The templates changed since you opened this page. Reload and review them again.';
  end if;
  for t in select * from public.onboarding_email_templates loop
    v_problem := public._trial_nudge_content_problem('service', t.subject, t.body);
    if v_problem is not null then
      raise exception 'Template % cannot be approved: %', t.rule_key, v_problem;
    end if;
  end loop;

  update public.onboarding_settings
     set templates_approved_hash = v_hash, templates_approved_by = p_by, templates_approved_at = now(), updated_at = now()
   where id;
  perform public._onboarding_audit(null, null, null, 'templates_approved', p_by, jsonb_build_object('template_hash', v_hash));
end;
$$;

create or replace function public.admin_set_onboarding_milestone(
  p_key text, p_enabled boolean, p_required boolean, p_weight integer, p_by uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  if p_enabled is null or p_required is null or p_weight is null or p_weight not between 1 and 10 then
    raise exception 'Enabled, required and a weight from 1 to 10 are needed.';
  end if;
  if not exists (select 1 from public.onboarding_milestone_config where key = p_key) then
    raise exception 'Unknown milestone.';
  end if;
  update public.onboarding_milestone_config
     set enabled = p_enabled, required = (p_required and p_enabled), weight = p_weight, updated_at = now(), updated_by = p_by
   where key = p_key;
  perform public._onboarding_audit(null, null, null, 'milestone_changed', p_by,
    jsonb_build_object('milestone', p_key, 'enabled', p_enabled, 'required', p_required and p_enabled, 'weight', p_weight));
end;
$$;

create or replace function public.admin_add_onboarding_note(p_school_id uuid, p_kind text, p_note text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  if p_kind not in ('call', 'demo', 'challenge', 'other') then
    raise exception 'Unknown note type.';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'A note must be between 1 and 2000 characters.';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found.';
  end if;
  insert into public.school_onboarding_notes (school_id, kind, note, created_by)
  values (p_school_id, p_kind, btrim(p_note), p_by) returning id into v_id;
  perform public._onboarding_audit(p_school_id, null, null, 'note_added', p_by, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

-- Mark an alert dealt with (resolve) or not needed (dismiss). The alert stays suppressed until the condition clears.
create or replace function public.admin_resolve_onboarding_followup(p_id uuid, p_dismiss boolean, p_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.onboarding_followups%rowtype;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  select * into f from public.onboarding_followups where id = p_id for update;
  if not found then raise exception 'Follow-up not found.'; end if;
  if f.kind <> 'alert' then raise exception 'Only alerts can be resolved here.'; end if;
  if f.status <> 'open' then return; end if;
  update public.onboarding_followups
     set status = case when p_dismiss then 'dismissed' else 'resolved' end, resolved_at = now(), resolved_by = p_by, updated_at = now()
   where id = p_id;
  perform public._onboarding_audit(f.school_id, f.id, null, case when p_dismiss then 'alert_dismissed' else 'alert_resolved' end, p_by,
    jsonb_build_object('rule', f.rule_key));
end;
$$;

-- Manual follow-up: a person asks for one of the two service emails for a school. It does NOT send. It proposes the
-- message through the existing trial-nudge approval queue, where a person reviews and sends it with every existing
-- safeguard applied. The school's current state must still match.
create or replace function public.admin_trigger_onboarding_followup(p_school_id uuid, p_rule text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  t record;
  v_rule text;
  v_nudge uuid;
  v_followup uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage school onboarding.';
  end if;
  perform public._onboarding_require_member(p_by);
  if p_rule not in ('password_reminder_email', 'login_guidance_email') then
    raise exception 'Unknown follow-up.';
  end if;
  select * into r from public._onboarding_rows() x where x.school_id = p_school_id;
  if not found then raise exception 'School not found.'; end if;
  if p_rule = 'password_reminder_email' and r.status <> 'password_pending' then
    raise exception 'This school has already changed its password, so a password reminder does not apply.';
  end if;
  if p_rule = 'login_guidance_email' and r.status <> 'not_started' then
    raise exception 'This school''s administrator has already logged in or has not set a password, so login guidance does not apply.';
  end if;
  select * into t from public.onboarding_email_templates where rule_key = p_rule;
  if not found then raise exception 'Template not found.'; end if;

  -- Goes through the existing proposal function: it re-checks super admin, content, suppression,
  -- asked_to_stop, the 3-day cap and the one-open-message rule, and raises a plain-language reason if refused.
  v_nudge := public.admin_propose_trial_nudge(p_school_id, 'service', t.subject, t.body, p_by);

  v_rule := case p_rule when 'password_reminder_email' then 'manual_password_reminder' else 'manual_login_guidance' end;
  insert into public.onboarding_followups (school_id, rule_key, kind, status, detail, nudge_id)
  values (p_school_id, v_rule, 'email', 'pending_approval', jsonb_build_object('automatic', false, 'status_at_request', r.status), v_nudge)
  returning id into v_followup;
  perform public._onboarding_audit(p_school_id, v_followup, v_nudge, 'manual_followup_proposed', p_by, jsonb_build_object('rule', p_rule));
  return v_nudge;
end;
$$;

-- ============================================================
-- Grants
-- ============================================================
revoke all on function public._onboarding_audit(uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._onboarding_templates_hash() from public, anon, authenticated;
revoke all on function public._onboarding_automation_active() from public, anon, authenticated;
revoke all on function public._onboarding_rows() from public, anon, authenticated;
revoke all on function public._onboarding_queue_email(uuid, text) from public, anon, authenticated;
revoke all on function public._onboarding_require_member(uuid) from public, anon, authenticated;
revoke all on function public.onboarding_run_rules(boolean) from public, anon, authenticated;
revoke all on function public.onboarding_pending_sends(integer) from public, anon, authenticated;
revoke all on function public.onboarding_recheck_before_send(uuid) from public, anon, authenticated;
revoke all on function public.onboarding_record_delivery(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.onboarding_run_rules(boolean) to service_role;
grant execute on function public.onboarding_pending_sends(integer) to service_role;
grant execute on function public.onboarding_recheck_before_send(uuid) to service_role;
grant execute on function public.onboarding_record_delivery(uuid, boolean, text) to service_role;

revoke all on function public.record_school_login() from public, anon;
grant execute on function public.record_school_login() to authenticated;

revoke all on function public.admin_onboarding_summary() from public, anon;
revoke all on function public.admin_onboarding_list(text, date, date, text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_onboarding_school_detail(uuid) from public, anon;
revoke all on function public.admin_onboarding_followup_queue(integer, integer) from public, anon;
revoke all on function public.admin_get_onboarding_config() from public, anon;
revoke all on function public.admin_set_onboarding_settings(boolean, timestamptz, integer, integer, integer, integer, integer, uuid) from public, anon;
revoke all on function public.admin_approve_onboarding_templates(text, uuid) from public, anon;
revoke all on function public.admin_set_onboarding_milestone(text, boolean, boolean, integer, uuid) from public, anon;
revoke all on function public.admin_add_onboarding_note(uuid, text, text, uuid) from public, anon;
revoke all on function public.admin_resolve_onboarding_followup(uuid, boolean, uuid) from public, anon;
revoke all on function public.admin_trigger_onboarding_followup(uuid, text, uuid) from public, anon;
grant execute on function public.admin_onboarding_summary() to authenticated;
grant execute on function public.admin_onboarding_list(text, date, date, text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_onboarding_school_detail(uuid) to authenticated;
grant execute on function public.admin_onboarding_followup_queue(integer, integer) to authenticated;
grant execute on function public.admin_get_onboarding_config() to authenticated;
grant execute on function public.admin_set_onboarding_settings(boolean, timestamptz, integer, integer, integer, integer, integer, uuid) to authenticated;
grant execute on function public.admin_approve_onboarding_templates(text, uuid) to authenticated;
grant execute on function public.admin_set_onboarding_milestone(text, boolean, boolean, integer, uuid) to authenticated;
grant execute on function public.admin_add_onboarding_note(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_resolve_onboarding_followup(uuid, boolean, uuid) to authenticated;
grant execute on function public.admin_trigger_onboarding_followup(uuid, text, uuid) to authenticated;
