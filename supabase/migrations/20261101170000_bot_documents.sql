-- Phase 2.1+2.2 (1/2): WhatsApp bot documents (report card PDF + fee statement PDF), database core.
-- Additive only; ships dark.
--
-- * New flag feature.bot.documents (catalog entry, enabled for nobody). Every function below
--   refuses, and the bot behaves exactly as today, while the flag is off for a school.
-- * bot_guardian_pins: a guardian's own 4-6 digit WhatsApp PIN (bcrypt, salted with the guardian id).
--   Set only from the signed-in parent portal (set_bot_pin). The bot asks for it before sending ANY
--   document, so a phone number alone never unlocks a child's results or fee ledger. 5 wrong
--   attempts lock the PIN for 30 minutes.
-- * bot_document_requests: one row per document asked for over WhatsApp (audit + one-shot state).
--   awaiting_pin -> pin_verified -> generating -> delivered | failed | denied (or expired/cancelled).
-- * bot-documents storage bucket: PRIVATE, PDF only, no storage policies, so only the service role
--   (the PDF route) can write it and clients can only reach a file through a short-lived signed URL.
-- * Existing tables, functions and the existing text bot are not touched.
-- Rollback: switch the flag off; nothing else depends on these objects.

-- 1. Flag catalog entry (visible in admin, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.documents',
       'WhatsApp bot documents',
       'Lets the WhatsApp bot send a guardian the latest released report card PDF and a fee statement PDF, after a PIN set in the parent portal. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.documents'
);

-- 2. Guardian PINs. No policies and no client grants: only the functions below touch it.
create table if not exists public.bot_guardian_pins (
  guardian_user_id uuid primary key references public.school_users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  pin_hash text not null,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.bot_guardian_pins is
  'A guardian''s WhatsApp document PIN (bcrypt hash, never the PIN). Written only by set_bot_pin() / bot_submit_pin(). RLS on with no policies and no client grants: internal.';
alter table public.bot_guardian_pins enable row level security;
revoke all on table public.bot_guardian_pins from anon, authenticated;

-- 3. Document requests (audit trail and one-shot state).
create table if not exists public.bot_document_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  guardian_user_id uuid not null references public.school_users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  doc_type text not null check (doc_type in ('report_card', 'statement')),
  status text not null default 'awaiting_pin'
    check (status in ('awaiting_pin', 'pin_verified', 'generating', 'delivered', 'failed', 'denied', 'expired', 'cancelled')),
  failure_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  pin_verified_at timestamptz,
  completed_at timestamptz
);
comment on table public.bot_document_requests is
  'One row per document a guardian asked the WhatsApp bot for. Written only by the bot_* functions. RLS on with no policies and no client grants: internal.';
create unique index if not exists bot_document_requests_one_open_per_conversation
  on public.bot_document_requests (conversation_id)
  where status in ('awaiting_pin', 'pin_verified', 'generating');
create index if not exists bot_document_requests_guardian_recent
  on public.bot_document_requests (guardian_user_id, created_at desc);
alter table public.bot_document_requests enable row level security;
revoke all on table public.bot_document_requests from anon, authenticated;

-- 4. Private bucket for the generated PDFs. No storage policies on purpose.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bot-documents', 'bot-documents', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- 5. Is the feature on for this school? (service role only; the edge function asks before it
--    changes how it understands a message.)
create or replace function public.bot_documents_enabled(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.school_has_feature_flag(p_school_id, 'feature.bot.documents');
$$;
revoke all on function public.bot_documents_enabled(uuid) from public, anon, authenticated;
grant execute on function public.bot_documents_enabled(uuid) to service_role;

-- 6. Guardian sets or changes their own PIN (signed-in parent portal).
create or replace function public.set_bot_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_guardian uuid;
  v_school uuid := auth_school_id();
begin
  select su.id into v_guardian
    from public.school_users su
    join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid()
     and su.school_id = v_school
     and su.status = 'active'
     and r.name = 'parent';
  if v_guardian is null then
    raise exception 'Only a parent or guardian account can set a WhatsApp PIN.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.bot.documents') then
    raise exception 'WhatsApp documents are not enabled for this school.' using errcode = '55000';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'The PIN must be 4 to 6 digits.' using errcode = '22023';
  end if;
  if p_pin ~ '^([0-9])\1+$'
     or strpos('0123456789', p_pin) > 0
     or strpos('9876543210', p_pin) > 0 then
    raise exception 'That PIN is too easy to guess. Avoid repeated or sequential digits.' using errcode = '22023';
  end if;

  insert into public.bot_guardian_pins as p (guardian_user_id, school_id, pin_hash)
  values (v_guardian, v_school, extensions.crypt(v_guardian::text || ':' || p_pin, extensions.gen_salt('bf', 8)))
  on conflict (guardian_user_id) do update set
    pin_hash = excluded.pin_hash,
    failed_attempts = 0,
    locked_until = null,
    set_at = now(),
    updated_at = now();
end;
$$;
revoke all on function public.set_bot_pin(text) from public, anon;
grant execute on function public.set_bot_pin(text) to authenticated;

-- 7. Has this guardian set a PIN? (for the portal screen; never returns the hash)
create or replace function public.bot_pin_is_set()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.bot_guardian_pins p
      join public.school_users su on su.id = p.guardian_user_id
     where su.auth_user_id = auth.uid()
       and su.school_id = auth_school_id()
  );
$$;
revoke all on function public.bot_pin_is_set() from public, anon;
grant execute on function public.bot_pin_is_set() to authenticated;

-- 8. Bot: start a document request. Returns {status, request_id?}:
--    no_pin (guardian has not set a PIN yet), daily_limit, or awaiting_pin (PIN now needed).
create or replace function public.bot_begin_document_request(
  p_school_id uuid,
  p_conversation_id uuid,
  p_guardian_user_id uuid,
  p_student_id uuid,
  p_doc_type text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_today integer;
begin
  if p_doc_type not in ('report_card', 'statement') then
    raise exception 'Unknown document type.' using errcode = '22023';
  end if;
  if not public.school_has_feature_flag(p_school_id, 'feature.bot.documents') then
    raise exception 'WhatsApp documents are not enabled for this school.' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.whatsapp_conversations c
     where c.id = p_conversation_id and c.school_id = p_school_id and c.guardian_user_id = p_guardian_user_id
  ) then
    raise exception 'Conversation does not match this guardian.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.student_guardians sg
      join public.students st on st.id = sg.student_id
     where sg.guardian_user_id = p_guardian_user_id and sg.student_id = p_student_id and st.school_id = p_school_id
  ) then
    raise exception 'Guardian is not linked to this student.' using errcode = '42501';
  end if;

  -- A request stuck in 'generating' (PDF route crashed) must not block this conversation for good.
  update public.bot_document_requests
     set status = 'failed', completed_at = now(), failure_reason = 'Timed out while generating.'
   where conversation_id = p_conversation_id and status = 'generating'
     and pin_verified_at < now() - interval '10 minutes';
  update public.bot_document_requests
     set status = 'cancelled', completed_at = now()
   where conversation_id = p_conversation_id and status in ('awaiting_pin', 'pin_verified');

  if not exists (select 1 from public.bot_guardian_pins where guardian_user_id = p_guardian_user_id) then
    return jsonb_build_object('status', 'no_pin');
  end if;

  select count(*) into v_today from public.bot_document_requests
   where guardian_user_id = p_guardian_user_id and status = 'delivered' and created_at > now() - interval '24 hours';
  if v_today >= 10 then
    return jsonb_build_object('status', 'daily_limit');
  end if;

  insert into public.bot_document_requests (school_id, conversation_id, guardian_user_id, student_id, doc_type, expires_at)
  values (p_school_id, p_conversation_id, p_guardian_user_id, p_student_id, p_doc_type, now() + interval '5 minutes')
  returning id into v_id;
  return jsonb_build_object('status', 'awaiting_pin', 'request_id', v_id);
end;
$$;
revoke all on function public.bot_begin_document_request(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bot_begin_document_request(uuid, uuid, uuid, uuid, text) to service_role;

-- 9. Bot: is this conversation waiting for a PIN? Returns the request id or null. Expires stale ones.
create or replace function public.bot_pending_pin_request(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  update public.bot_document_requests
     set status = 'expired', completed_at = now()
   where conversation_id = p_conversation_id and status = 'awaiting_pin' and expires_at < now();
  select id into v_id from public.bot_document_requests
   where conversation_id = p_conversation_id and status = 'awaiting_pin' and expires_at >= now();
  return v_id;
end;
$$;
revoke all on function public.bot_pending_pin_request(uuid) from public, anon, authenticated;
grant execute on function public.bot_pending_pin_request(uuid) to service_role;

-- 10. Bot: check the PIN a guardian typed. Returns {result: ok|wrong|locked|no_pin|none, ...}.
create or replace function public.bot_submit_pin(p_conversation_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req record;
  v_pin record;
  v_attempts integer;
begin
  select * into v_req from public.bot_document_requests
   where conversation_id = p_conversation_id and status = 'awaiting_pin' and expires_at >= now()
   for update;
  if v_req.id is null then
    return jsonb_build_object('result', 'none');
  end if;

  select * into v_pin from public.bot_guardian_pins where guardian_user_id = v_req.guardian_user_id for update;
  if v_pin.guardian_user_id is null then
    update public.bot_document_requests set status = 'cancelled', completed_at = now() where id = v_req.id;
    return jsonb_build_object('result', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    update public.bot_document_requests set status = 'cancelled', completed_at = now() where id = v_req.id;
    return jsonb_build_object('result', 'locked');
  end if;

  if p_pin is not null
     and v_pin.pin_hash = extensions.crypt(v_req.guardian_user_id::text || ':' || p_pin, v_pin.pin_hash) then
    update public.bot_guardian_pins set failed_attempts = 0, locked_until = null, updated_at = now()
     where guardian_user_id = v_req.guardian_user_id;
    update public.bot_document_requests set status = 'pin_verified', pin_verified_at = now() where id = v_req.id;
    return jsonb_build_object('result', 'ok', 'request_id', v_req.id, 'doc_type', v_req.doc_type, 'student_id', v_req.student_id);
  end if;

  v_attempts := v_pin.failed_attempts + 1;
  if v_attempts >= 5 then
    update public.bot_guardian_pins
       set failed_attempts = 0, locked_until = now() + interval '30 minutes', updated_at = now()
     where guardian_user_id = v_req.guardian_user_id;
    update public.bot_document_requests set status = 'cancelled', completed_at = now() where id = v_req.id;
    return jsonb_build_object('result', 'locked');
  end if;
  update public.bot_guardian_pins set failed_attempts = v_attempts, updated_at = now()
   where guardian_user_id = v_req.guardian_user_id;
  return jsonb_build_object('result', 'wrong', 'attempts_left', 5 - v_attempts);
end;
$$;
revoke all on function public.bot_submit_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.bot_submit_pin(uuid, text) to service_role;

-- 11. PDF route: claim a PIN-verified request exactly once (pin_verified -> generating).
--     Returns the request details, or null when it is not claimable (wrong state, too old, flag off).
create or replace function public.bot_claim_document_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req record;
begin
  select * into v_req from public.bot_document_requests
   where id = p_request_id and status = 'pin_verified' and pin_verified_at > now() - interval '10 minutes'
   for update;
  if v_req.id is null then
    return null;
  end if;
  if not public.school_has_feature_flag(v_req.school_id, 'feature.bot.documents') then
    return null;
  end if;
  update public.bot_document_requests set status = 'generating' where id = v_req.id;
  return jsonb_build_object(
    'request_id', v_req.id, 'school_id', v_req.school_id, 'guardian_user_id', v_req.guardian_user_id,
    'student_id', v_req.student_id, 'doc_type', v_req.doc_type, 'conversation_id', v_req.conversation_id
  );
end;
$$;
revoke all on function public.bot_claim_document_request(uuid) from public, anon, authenticated;
grant execute on function public.bot_claim_document_request(uuid) to service_role;

-- 12. Record the outcome (delivered / failed / denied).
create or replace function public.bot_complete_document_request(p_request_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_status not in ('delivered', 'failed', 'denied') then
    raise exception 'Invalid outcome.' using errcode = '22023';
  end if;
  update public.bot_document_requests
     set status = p_status,
         completed_at = now(),
         failure_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = p_request_id and status in ('pin_verified', 'generating');
end;
$$;
revoke all on function public.bot_complete_document_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.bot_complete_document_request(uuid, text, text) to service_role;
