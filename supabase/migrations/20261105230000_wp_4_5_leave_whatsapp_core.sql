-- WP 4.5 HR approvals over WhatsApp, LEAVE ONLY (1/2): database core. ADDITIVE ONLY, flag off for every school.
--
-- An approver who registered their own WhatsApp number (WP 3.3 director registry) and separately consented to
-- "approve leave by WhatsApp" can list pending leave, ask to approve/reject one request, receive a one-time 6-digit
-- code at the SAME number, and send the code back. Only then is the decision recorded. No money, no payroll.
--
-- Facts this is built on (audited against the live database, not assumed):
--   * The app decides leave with a direct UPDATE of leave_requests under row-level security (policy needs
--     staff.leave.approve in the same school). There is NO approve function to reuse, so nothing existing is edited.
--   * auth_has_permission() reads auth.uid(), so a service-role caller cannot use it. leave_wa_effective_permission()
--     reproduces its order exactly: user override, then the school's role override, then the default role grant, else false.
--   * The database does NOT stop an approver changing their OWN request (only the app hides it). The functions here
--     refuse it. (Fixing the policy itself would edit an existing policy: not done, flagged for the owner.)
--   * notify_school_user() depends on the caller's school, so the decision function writes the in-app notification
--     itself, using the same notification_allowed() check and the same notification_logs shape.
--
-- Safety: flag + consent + director registry (active registration, active staff user whose profile phone still equals the
-- number, allowed role, not also a guardian) + effective permission are re-checked at EVERY step and at the moment of
-- decision. Codes are stored hashed (never plain), single use, expire in 5 minutes, 3 wrong attempts burn them. Decisions
-- for leave longer than 5 days, and the approver's own leave, are refused here (use the app). A Twilio retry is a no-op
-- (unique message_sid). The decision UPDATE must change exactly one row or the function raises.
--
-- Added: one flag, three tables, service_role-only functions, two authenticated consent functions. Nothing existing is edited.

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.hr_approvals',
       'WhatsApp bot: approve leave',
       'Approvers who registered their own WhatsApp number and consented can approve or reject leave of up to 5 days with a one-time code. Leave only. Needs feature.bot.director. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.hr_approvals');

create table if not exists public.leave_wa_consent (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  consent_text text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists leave_wa_consent_one_active on public.leave_wa_consent (school_user_id) where status = 'active';

create table if not exists public.leave_wa_codes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists leave_wa_codes_user on public.leave_wa_codes (school_user_id, created_at desc);

create table if not exists public.leave_wa_decisions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  approver_school_user_id uuid not null references public.school_users(id) on delete cascade,
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  message_sid text,
  created_at timestamptz not null default now()
);
comment on table public.leave_wa_decisions is 'WP 4.5: one row per leave decision made on WhatsApp (who, which request, outcome, MessageSid; never the code). The app can show "via WhatsApp" from this.';
create unique index if not exists leave_wa_decisions_message_sid on public.leave_wa_decisions (message_sid) where message_sid is not null;
create unique index if not exists leave_wa_decisions_one_per_request on public.leave_wa_decisions (leave_request_id);

alter table public.leave_wa_consent enable row level security;
alter table public.leave_wa_codes enable row level security;
alter table public.leave_wa_decisions enable row level security;
revoke all on public.leave_wa_consent from public, anon, authenticated;
revoke all on public.leave_wa_codes from public, anon, authenticated;
revoke all on public.leave_wa_decisions from public, anon, authenticated;

-- Internal: the effective permission of ONE staff member, same order as auth_has_permission().
create or replace function public.leave_wa_effective_permission(p_school_user_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with c as (select su.id, su.school_id, su.role_id from public.school_users su where su.id = p_school_user_id and su.status = 'active')
  select coalesce(
    (select upo.allowed from public.user_permission_overrides upo, c where upo.school_user_id = c.id and upo.permission_key = p_key),
    (select rp.allowed from public.role_permissions rp, c where rp.role_id = c.role_id and rp.school_id = c.school_id and rp.permission_key = p_key),
    (select rp.allowed from public.role_permissions rp, c where rp.role_id = c.role_id and rp.school_id is null and rp.permission_key = p_key),
    false);
$function$;

-- Internal: the approver a WhatsApp number belongs to, only while EVERYTHING still holds.
create or replace function public.leave_wa_verify(p_phone text)
returns table (school_id uuid, school_user_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return query
  select d.school_id, d.school_user_id
    from public.director_whatsapp_lookup(p_phone) d
   where public.school_has_feature_flag(d.school_id, 'feature.bot.hr_approvals')
     and exists (select 1 from public.leave_wa_consent c where c.school_user_id = d.school_user_id and c.status = 'active')
     and public.leave_wa_effective_permission(d.school_user_id, 'staff.leave.approve')
   limit 1;
end
$function$;

-- Authenticated approver grants / revokes the separate consent. The wording below is a DRAFT pending owner approval; no
-- screen offers it yet. Requires an active director WhatsApp registration and the permission right now.
create or replace function public.leave_wa_consent_grant(p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_su uuid;
  v_school uuid;
begin
  select su.id, su.school_id into v_su, v_school from public.school_users su where su.auth_user_id = auth.uid() and su.status = 'active' limit 1;
  if v_su is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_consent is not true then return jsonb_build_object('status', 'consent_required'); end if;
  if not public.school_has_feature_flag(v_school, 'feature.bot.hr_approvals') then return jsonb_build_object('status', 'disabled'); end if;
  if not exists (select 1 from public.director_whatsapp_numbers n where n.school_user_id = v_su and n.status = 'active') then
    return jsonb_build_object('status', 'register_number_first');
  end if;
  if not public.leave_wa_effective_permission(v_su, 'staff.leave.approve') then return jsonb_build_object('status', 'not_allowed'); end if;
  insert into public.leave_wa_consent (school_id, school_user_id, consent_text)
  values (v_school, v_su, 'DRAFT: I allow EduCore to let me approve or reject staff leave of up to 5 days by WhatsApp from my registered number, using a one-time code sent to that same number. I understand anyone holding my phone could do this, and that I can withdraw this at any time.')
  on conflict (school_user_id) where status = 'active' do nothing;
  return jsonb_build_object('status', 'granted');
end
$function$;

create or replace function public.leave_wa_consent_revoke()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_su uuid;
begin
  select su.id into v_su from public.school_users su where su.auth_user_id = auth.uid() and su.status = 'active' limit 1;
  if v_su is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.leave_wa_consent set status = 'revoked', revoked_at = now() where school_user_id = v_su and status = 'active';
  return found;
end
$function$;

-- Step 1: "pending leave". Up to 5 oldest pending requests of 5 days or less that are not the approver's own.
-- ref = 4 characters derived from the request id; the caller refuses an ambiguous ref.
create or replace function public.leave_wa_pending(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
  v_items jsonb;
  v_other integer;
begin
  select * into v from public.leave_wa_verify(p_phone);
  if not found then return jsonb_build_object('status', 'not_approver'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('ref', upper(substr(md5(x.id::text), 1, 4)), 'name', x.full_name, 'type', x.type_name,
           'start', x.start_date, 'end', x.end_date, 'days', x.days_count) order by x.created_at), '[]'::jsonb)
    into v_items
    from (select lr.id, lr.created_at, lr.start_date, lr.end_date, lr.days_count, su.full_name, lt.name as type_name
            from public.leave_requests lr
            join public.school_users su on su.id = lr.staff_id
            join public.leave_types lt on lt.id = lr.leave_type_id
           where lr.school_id = v.school_id and lr.status = 'pending' and lr.staff_id <> v.school_user_id and lr.days_count <= 5
           order by lr.created_at limit 5) x;

  select count(*) into v_other from public.leave_requests lr
   where lr.school_id = v.school_id and lr.status = 'pending' and lr.staff_id <> v.school_user_id and lr.days_count > 5;

  return jsonb_build_object('status', 'ok', 'items', v_items, 'in_app_only', v_other);
end
$function$;

-- Step 2: "approve K7F2" / "reject K7F2". Issues a one-time code (returned ONCE so the webhook can send it to the same
-- number; only its hash is stored). Statuses: code_issued | not_approver | not_found | ambiguous | own_request | too_long
-- | rate_limited
create or replace function public.leave_wa_request_code(p_phone text, p_ref text, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
  r record;
  v_n integer;
  v_code text;
  v_id uuid := gen_random_uuid();
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'bad decision'; end if;
  select * into v from public.leave_wa_verify(p_phone);
  if not found then return jsonb_build_object('status', 'not_approver'); end if;

  select count(*) into v_n from public.leave_requests lr
   where lr.school_id = v.school_id and lr.status = 'pending' and upper(substr(md5(lr.id::text), 1, 4)) = upper(p_ref);
  if v_n = 0 then return jsonb_build_object('status', 'not_found'); end if;
  if v_n > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  select lr.id, lr.staff_id, lr.days_count, su.full_name into r
    from public.leave_requests lr join public.school_users su on su.id = lr.staff_id
   where lr.school_id = v.school_id and lr.status = 'pending' and upper(substr(md5(lr.id::text), 1, 4)) = upper(p_ref);

  if r.staff_id = v.school_user_id then return jsonb_build_object('status', 'own_request'); end if;
  if r.days_count > 5 then return jsonb_build_object('status', 'too_long'); end if;
  if not public.increment_and_check_rate_limit('leave-wa-code:' || v.school_user_id::text, 10, 3600) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update public.leave_wa_codes set used_at = now() where school_user_id = v.school_user_id and used_at is null;
  -- 6 digits from a CSPRNG-backed uuid
  v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.leave_wa_codes (id, school_id, school_user_id, leave_request_id, decision, code_hash, expires_at)
  values (v_id, v.school_id, v.school_user_id, r.id, p_decision, encode(sha256(convert_to(v_code || ':' || v_id::text, 'UTF8')), 'hex'), now() + interval '5 minutes');

  return jsonb_build_object('status', 'code_issued', 'code', v_code, 'decision', p_decision, 'name', r.full_name, 'days', r.days_count);
end
$function$;

-- Step 3: the approver replies with the code. Re-verifies everything, records the decision, notifies the requester.
-- Statuses: recorded | duplicate | not_approver | no_code | expired | wrong_code (with attempts_left) | locked
--         | no_longer_pending | own_request | too_long
create or replace function public.leave_wa_decide(p_phone text, p_code text, p_message_sid text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
  c public.leave_wa_codes%rowtype;
  r record;
  v_rows integer;
begin
  select * into v from public.leave_wa_verify(p_phone);
  if not found then return jsonb_build_object('status', 'not_approver'); end if;

  if p_message_sid is not null and exists (select 1 from public.leave_wa_decisions d where d.message_sid = p_message_sid) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select * into c from public.leave_wa_codes
   where school_user_id = v.school_user_id and used_at is null
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status', 'no_code'); end if;
  if c.expires_at <= now() then
    update public.leave_wa_codes set used_at = now() where id = c.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if c.attempts >= 3 then
    update public.leave_wa_codes set used_at = now() where id = c.id;
    return jsonb_build_object('status', 'locked');
  end if;

  if encode(sha256(convert_to(coalesce(p_code, '') || ':' || c.id::text, 'UTF8')), 'hex') <> c.code_hash then
    update public.leave_wa_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 3 then now() else null end where id = c.id;
    return jsonb_build_object('status', case when c.attempts + 1 >= 3 then 'locked' else 'wrong_code' end, 'attempts_left', greatest(2 - c.attempts, 0));
  end if;

  select lr.id, lr.staff_id, lr.days_count, lr.status into r from public.leave_requests lr
   where lr.id = c.leave_request_id and lr.school_id = v.school_id for update;
  if not found or r.status <> 'pending' then
    update public.leave_wa_codes set used_at = now() where id = c.id;
    return jsonb_build_object('status', 'no_longer_pending');
  end if;
  if r.staff_id = v.school_user_id then return jsonb_build_object('status', 'own_request'); end if;
  if r.days_count > 5 then return jsonb_build_object('status', 'too_long'); end if;

  update public.leave_requests set status = c.decision, approved_by = v.school_user_id, approved_at = now()
   where id = r.id and school_id = v.school_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'leave decision changed % rows, expected exactly 1', v_rows;
  end if;

  update public.leave_wa_codes set used_at = now() where id = c.id;
  insert into public.leave_wa_decisions (school_id, approver_school_user_id, leave_request_id, decision, message_sid)
  values (v.school_id, v.school_user_id, r.id, c.decision, p_message_sid);

  -- Same in-app notification the app sends (best effort: a failure here must not undo the decision).
  begin
    if public.notification_allowed(r.staff_id, 'other', 'in_app') then
      insert into public.notification_logs (school_id, recipient_school_user_id, recipient_phone, recipient_type, channel, subject, body, action_url, status, segments, sent_by)
      values (v.school_id, r.staff_id, '-', 'staff', 'in_app',
              case when c.decision = 'approved' then 'Leave request approved' else 'Leave request rejected' end,
              case when c.decision = 'approved' then 'Your leave request has been approved.' else 'Your leave request was not approved.' end,
              '/staff/' || r.staff_id::text || '?tab=leave', 'delivered', 1, v.school_user_id);
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('status', 'recorded', 'decision', c.decision);
end
$function$;

revoke all on function public.leave_wa_effective_permission(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.leave_wa_verify(text) from public, anon, authenticated, service_role;
revoke all on function public.leave_wa_consent_grant(boolean) from public, anon;
revoke all on function public.leave_wa_consent_revoke() from public, anon;
revoke all on function public.leave_wa_pending(text) from public, anon, authenticated;
revoke all on function public.leave_wa_request_code(text, text, text) from public, anon, authenticated;
revoke all on function public.leave_wa_decide(text, text, text) from public, anon, authenticated;
grant execute on function public.leave_wa_consent_grant(boolean) to authenticated;
grant execute on function public.leave_wa_consent_revoke() to authenticated;
grant execute on function public.leave_wa_pending(text) to service_role;
grant execute on function public.leave_wa_request_code(text, text, text) to service_role;
grant execute on function public.leave_wa_decide(text, text, text) to service_role;

-- Rollback: flag off. To remove: drop the seven leave_wa_* functions and the three leave_wa_* tables, delete the flag row.
