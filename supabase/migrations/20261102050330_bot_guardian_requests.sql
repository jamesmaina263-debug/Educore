-- Phase 2.4+2.5 (1/2): WhatsApp bot "report absence" and "update contact number", database core.
-- Additive only; ships dark. No money is involved.
--
-- * New flag feature.bot.guardian_requests (catalog entry, enabled for nobody). Every function below
--   refuses, and the bot behaves exactly as today, while the flag is off for a school.
-- * bot_guardian_requests: one row per request a guardian sends over WhatsApp.
--     - absence_report: a NOTE for the office ("my child will be absent on <date>, <reason>").
--       It NEVER writes to student_attendance: the register is only ever changed by staff.
--     - contact_update: a request to change the guardian's own phone number. It is QUEUED; nothing
--       changes until a member of staff with students.write approves it (the phone number is also how
--       the bot recognises the guardian, so it is never changed on the strength of a chat message).
-- * Existing tables, functions, policies and the existing text bot are not touched. The only existing
--   data that can change is school_users.phone, and only inside bot_review_request(), when staff
--   approve a contact_update, with an audit_log row.
-- Rollback: switch the flag off; nothing else depends on these objects.

-- 1. Flag catalog entry (visible in admin, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.guardian_requests',
       'WhatsApp bot guardian requests',
       'Lets a guardian tell the school over WhatsApp that a child will be absent, or ask to change their own phone number. Both go to the office as requests; the register and the phone number are only changed by staff. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.guardian_requests'
);

-- 2. Kenyan mobile number -> +254XXXXXXXXX (the format the WhatsApp webhook matches on), or NULL.
create or replace function public.bot_normalize_ke_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  s text := regexp_replace(coalesce(p_phone, ''), '[\s\-\(\)\.]', '', 'g');
begin
  if s ~ '^\+254[17][0-9]{8}$' then return s; end if;
  if s ~ '^254[17][0-9]{8}$' then return '+' || s; end if;
  if s ~ '^0[17][0-9]{8}$' then return '+254' || substr(s, 2); end if;
  return null;
end;
$$;

-- 3. The requests table.
create table if not exists public.bot_guardian_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  guardian_user_id uuid not null references public.school_users(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in ('absence_report', 'contact_update')),
  status text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'applied', 'rejected', 'cancelled')),
  absence_date date,
  reason text check (reason is null or char_length(reason) <= 300),
  new_phone text check (new_phone is null or new_phone ~ '^\+254[17][0-9]{8}$'),
  raw_text text check (raw_text is null or char_length(raw_text) <= 1000),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  reviewed_by uuid references public.school_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bot_guardian_requests_shape check (
    (kind = 'absence_report' and student_id is not null and absence_date is not null and new_phone is null
       and status in ('pending', 'acknowledged', 'rejected', 'cancelled'))
    or
    (kind = 'contact_update' and new_phone is not null and absence_date is null
       and status in ('pending', 'applied', 'rejected', 'cancelled'))
  )
);
comment on table public.bot_guardian_requests is
  'Requests a guardian sent the WhatsApp bot: absence notes (never touch the register) and own-phone-number changes (queued until staff approve). Written only by the bot_* functions. Staff read via RLS (communication.read).';

-- One open absence note per learner per day; one open phone change per guardian.
create unique index if not exists bot_guardian_requests_one_open_absence
  on public.bot_guardian_requests (student_id, absence_date)
  where kind = 'absence_report' and status = 'pending';
create unique index if not exists bot_guardian_requests_one_open_contact
  on public.bot_guardian_requests (guardian_user_id)
  where kind = 'contact_update' and status = 'pending';
create index if not exists bot_guardian_requests_school_recent
  on public.bot_guardian_requests (school_id, status, created_at desc);
create index if not exists bot_guardian_requests_guardian_recent
  on public.bot_guardian_requests (guardian_user_id, created_at desc);
create index if not exists bot_guardian_requests_conversation
  on public.bot_guardian_requests (conversation_id);
create index if not exists bot_guardian_requests_reviewed_by
  on public.bot_guardian_requests (reviewed_by);

alter table public.bot_guardian_requests enable row level security;
revoke all on table public.bot_guardian_requests from anon, authenticated;
grant select on table public.bot_guardian_requests to authenticated;

drop policy if exists bot_guardian_requests_select_staff on public.bot_guardian_requests;
create policy bot_guardian_requests_select_staff on public.bot_guardian_requests
  for select to authenticated
  using (school_id = public.auth_school_id() and public.auth_has_permission('communication.read'));

-- 4. Is the feature on for this school? (service role only; the edge function asks before it changes
--    how it understands a message.)
create or replace function public.bot_guardian_requests_enabled(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.guardian_requests'), false);
$$;

-- 5. Guardian says a child will be absent. Records a note only.
create or replace function public.bot_submit_absence_report(
  p_school_id uuid,
  p_conversation_id uuid,
  p_guardian_user_id uuid,
  p_student_id uuid,
  p_absence_date date,
  p_reason text,
  p_raw_text text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_id uuid;
begin
  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.guardian_requests'), false) then
    return jsonb_build_object('ok', false, 'code', 'flag_off');
  end if;

  if not exists (
    select 1 from public.whatsapp_conversations c
    where c.id = p_conversation_id and c.school_id = p_school_id and c.guardian_user_id = p_guardian_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'bad_conversation');
  end if;

  if not exists (
    select 1
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    where sg.guardian_user_id = p_guardian_user_id and sg.student_id = p_student_id and s.school_id = p_school_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_linked');
  end if;

  if p_absence_date is null or p_absence_date < v_today - 1 or p_absence_date > v_today + 30 then
    return jsonb_build_object('ok', false, 'code', 'bad_date');
  end if;

  if (select count(*) from public.bot_guardian_requests r
      where r.guardian_user_id = p_guardian_user_id and r.created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  insert into public.bot_guardian_requests
    (school_id, conversation_id, guardian_user_id, student_id, kind, absence_date, reason, raw_text)
  values
    (p_school_id, p_conversation_id, p_guardian_user_id, p_student_id, 'absence_report', p_absence_date,
     nullif(left(btrim(coalesce(p_reason, '')), 300), ''), left(p_raw_text, 1000))
  on conflict (student_id, absence_date) where kind = 'absence_report' and status = 'pending' do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id);
end;
$$;

-- 6. Guardian asks to change their own phone number. Queued only; nothing else changes.
create or replace function public.bot_submit_contact_update(
  p_school_id uuid,
  p_conversation_id uuid,
  p_guardian_user_id uuid,
  p_new_phone text,
  p_raw_text text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_phone text := public.bot_normalize_ke_phone(p_new_phone);
  v_current text;
  v_id uuid;
begin
  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.guardian_requests'), false) then
    return jsonb_build_object('ok', false, 'code', 'flag_off');
  end if;

  if not exists (
    select 1 from public.whatsapp_conversations c
    where c.id = p_conversation_id and c.school_id = p_school_id and c.guardian_user_id = p_guardian_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'bad_conversation');
  end if;

  select su.phone into v_current
  from public.school_users su
  where su.id = p_guardian_user_id and su.school_id = p_school_id and su.status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'bad_guardian');
  end if;

  if v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'bad_phone');
  end if;
  if public.bot_normalize_ke_phone(v_current) = v_phone then
    return jsonb_build_object('ok', false, 'code', 'same_number');
  end if;

  if (select count(*) from public.bot_guardian_requests r
      where r.guardian_user_id = p_guardian_user_id and r.created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  -- A newer request replaces the guardian's older open one.
  update public.bot_guardian_requests
     set status = 'cancelled', reviewed_at = now(), review_note = 'Replaced by a newer request'
   where guardian_user_id = p_guardian_user_id and kind = 'contact_update' and status = 'pending';

  insert into public.bot_guardian_requests
    (school_id, conversation_id, guardian_user_id, kind, new_phone, raw_text)
  values
    (p_school_id, p_conversation_id, p_guardian_user_id, 'contact_update', v_phone, left(p_raw_text, 1000))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 7. Staff: the queue (own school; communication.read; empty when the flag is off).
create or replace function public.bot_requests_for_review(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid;
  v_out jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_school := public.auth_school_id();
  if v_school is null
     or not coalesce(public.school_has_feature_flag(v_school, 'feature.bot.guardian_requests'), false)
     or not public.auth_has_permission('communication.read') then
    return '[]'::jsonb;
  end if;
  if p_status is null or p_status not in ('pending', 'acknowledged', 'applied', 'rejected', 'cancelled', 'all') then
    raise exception 'invalid status filter' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_out
  from (
    select r.id,
           r.kind,
           r.status,
           r.created_at,
           g.full_name as guardian_name,
           g.phone as guardian_phone,
           nullif(btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), '') as student_name,
           r.absence_date,
           r.reason,
           r.new_phone,
           r.review_note,
           r.reviewed_at,
           (r.kind = 'contact_update' and r.status = 'pending' and exists (
              select 1 from public.school_users o
              where o.school_id = r.school_id and o.id <> r.guardian_user_id and o.phone = r.new_phone
           )) as phone_conflict
    from public.bot_guardian_requests r
    join public.school_users g on g.id = r.guardian_user_id
    left join public.students s on s.id = r.student_id
    where r.school_id = v_school
      and (p_status = 'all' or r.status = p_status)
    order by r.created_at desc
    limit 200
  ) x;

  return v_out;
end;
$$;

-- 8. Staff: acknowledge / reject an absence note, or apply / reject a phone change.
create or replace function public.bot_review_request(p_request_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_school uuid;
  v_req public.bot_guardian_requests%rowtype;
  v_old_phone text;
  v_new_status text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('acknowledge', 'apply', 'reject') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  select su.id, su.school_id into v_actor, v_school
  from public.school_users su
  where su.auth_user_id = auth.uid() and su.status = 'active'
  limit 1;
  if v_actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if not coalesce(public.school_has_feature_flag(v_school, 'feature.bot.guardian_requests'), false) then
    raise exception 'feature is off for this school' using errcode = '55000';
  end if;

  select * into v_req from public.bot_guardian_requests r
  where r.id = p_request_id and r.school_id = v_school
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request is already %', v_req.status using errcode = '55000';
  end if;

  if v_req.kind = 'absence_report' then
    if p_decision = 'apply' then
      raise exception 'an absence note is acknowledged, not applied' using errcode = '22023';
    end if;
    if not public.auth_has_permission('attendance.mark') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_new_status := case p_decision when 'acknowledge' then 'acknowledged' else 'rejected' end;
  else
    if p_decision = 'acknowledge' then
      raise exception 'a phone change is applied or rejected' using errcode = '22023';
    end if;
    if not public.auth_has_permission('students.write') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_new_status := case p_decision when 'apply' then 'applied' else 'rejected' end;

    if p_decision = 'apply' then
      select su.phone into v_old_phone
      from public.school_users su
      where su.id = v_req.guardian_user_id and su.school_id = v_school and su.status = 'active'
      for update;
      if not found then
        raise exception 'guardian is no longer active' using errcode = '55000';
      end if;
      if exists (
        select 1 from public.school_users o
        where o.school_id = v_school and o.id <> v_req.guardian_user_id and o.phone = v_req.new_phone
      ) then
        raise exception 'that number already belongs to another user at this school' using errcode = '23505';
      end if;
      update public.school_users set phone = v_req.new_phone where id = v_req.guardian_user_id;
    end if;
  end if;

  update public.bot_guardian_requests
     set status = v_new_status, reviewed_by = v_actor, reviewed_at = now(), review_note = v_note
   where id = v_req.id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
  values (
    v_school, v_actor, 'bot_guardian_requests', v_req.id, 'bot_request_' || p_decision,
    case when v_req.kind = 'contact_update' and p_decision = 'apply'
         then jsonb_build_object('phone', v_old_phone) else null end,
    jsonb_build_object('kind', v_req.kind, 'status', v_new_status, 'guardian_user_id', v_req.guardian_user_id,
                       'new_phone', case when v_req.kind = 'contact_update' then v_req.new_phone else null end)
  );

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

-- 9. Grants. Submit/enabled/normalize are service-role only; the two staff functions check the caller themselves.
revoke all on function public.bot_normalize_ke_phone(text) from public, anon, authenticated;
grant execute on function public.bot_normalize_ke_phone(text) to service_role;

revoke all on function public.bot_guardian_requests_enabled(uuid) from public, anon, authenticated;
grant execute on function public.bot_guardian_requests_enabled(uuid) to service_role;

revoke all on function public.bot_submit_absence_report(uuid, uuid, uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.bot_submit_absence_report(uuid, uuid, uuid, uuid, date, text, text) to service_role;

revoke all on function public.bot_submit_contact_update(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bot_submit_contact_update(uuid, uuid, uuid, text, text) to service_role;

revoke all on function public.bot_requests_for_review(text) from public, anon;
grant execute on function public.bot_requests_for_review(text) to authenticated;

revoke all on function public.bot_review_request(uuid, text, text) from public, anon;
grant execute on function public.bot_review_request(uuid, text, text) to authenticated;
