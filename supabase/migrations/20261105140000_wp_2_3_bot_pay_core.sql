-- WP 2.3 Bot "pay fees" (1/2): database core. ADDITIVE ONLY, flag off for every school.
--
-- A guardian tells the WhatsApp bot "pay 5000" (or "pay all"). The bot reads the outstanding balance, asks the guardian
-- to reply YES, and on YES raises an M-Pesa STK request for the GUARDIAN'S OWN REGISTERED NUMBER (a number typed in chat is
-- never used). The prompt is then sent by the existing mpesa-stk-push, in its internal mode (WP 1.3b); the existing callback
-- records the payment. The bot never sees or takes a PIN.
--
-- Added here: one flag, one table (the confirmation state and the audit trail, no phone numbers, no PINs), five
-- service_role-only functions, and a CREATE OR REPLACE of mpesa_stk_internal_dispatch_allowed() (created by WP 1.3b for
-- exactly this) so the internal push mode also accepts bot-raised requests. Nothing else existing is edited.
--
-- Rules enforced in the database (the bot only formats text): guardian linked to THIS learner in THIS school; flag on and
-- M-Pesa active; whole shillings, minimum KES 10, never more than the learner's outstanding balance (v_student_balances,
-- the same figure the fee-balance answer uses), re-checked at confirm time; 10-minute confirmation window; one prompt at
-- a time; rate limits per guardian and per phone (the phone bucket is shared with staff push and Pay by Link).

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.pay',
       'WhatsApp bot: pay fees (M-Pesa)',
       'A guardian can ask the bot to pay fees: the bot confirms the amount, then sends an M-Pesa prompt to the guardian''s own registered number. Needs M-Pesa active. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.pay');

create table if not exists public.bot_pay_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  guardian_user_id uuid not null references public.school_users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 10 and amount <= 150000),
  status text not null default 'awaiting_confirm' check (status in ('awaiting_confirm', 'started', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  stk_request_id uuid unique references public.mpesa_stk_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.bot_pay_requests is 'WP 2.3: confirmation state and audit trail for bot-initiated payments. No phone numbers, no PINs. Written only by the bot_guardian_pay_* functions.';
create index if not exists bot_pay_requests_conversation on public.bot_pay_requests (conversation_id, created_at desc);
alter table public.bot_pay_requests enable row level security;
revoke all on public.bot_pay_requests from public, anon, authenticated;

-- Flag on AND M-Pesa active for the school.
create or replace function public.bot_pay_enabled(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.pay'), false)
     and exists (select 1 from public.mpesa_settings m where m.school_id = p_school_id and m.is_active = true);
$function$;

-- Internal: the guardian's registered phone as 2547XXXXXXXX / 2541XXXXXXXX, or null.
create or replace function public.bot_pay_guardian_phone(p_school_id uuid, p_guardian_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_raw text;
  v_digits text;
begin
  select su.phone into v_raw from public.school_users su
   where su.id = p_guardian_user_id and su.school_id = p_school_id and su.status = 'active';
  v_digits := regexp_replace(coalesce(v_raw, ''), '[^0-9]', '', 'g');
  if v_digits ~ '^0[17][0-9]{8}$' then v_digits := '254' || substr(v_digits, 2);
  elsif v_digits ~ '^[17][0-9]{8}$' then v_digits := '254' || v_digits;
  end if;
  return case when v_digits ~ '^254[17][0-9]{8}$' then v_digits else null end;
end
$function$;

-- Internal: is this guardian a parent of THIS school, linked to THIS learner, with the learner in this school?
create or replace function public.bot_pay_guardian_linked(p_school_id uuid, p_guardian_user_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.school_users gu
      join public.student_guardians sg on sg.guardian_user_id = gu.id
      join public.students s on s.id = sg.student_id
     where gu.id = p_guardian_user_id and gu.school_id = p_school_id and gu.status = 'active'
       and sg.student_id = p_student_id and s.school_id = p_school_id
  );
$function$;

-- Step 1. p_amount null means "tell me the balance and ask how much". Otherwise validates and stores a confirmation request.
-- Returns jsonb: status = ask_amount | awaiting_confirm | forbidden | disabled | not_configured | no_balance | too_low | too_high
--                          | not_whole | rate_limited
create or replace function public.bot_guardian_pay_prepare(
  p_school_id uuid, p_conversation_id uuid, p_guardian_user_id uuid, p_student_id uuid, p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance numeric;
  v_phone text;
begin
  if p_school_id is null or p_conversation_id is null or p_guardian_user_id is null or p_student_id is null
     or not public.bot_pay_guardian_linked(p_school_id, p_guardian_user_id, p_student_id)
     or not exists (select 1 from public.whatsapp_conversations c where c.id = p_conversation_id and c.school_id = p_school_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not public.bot_pay_enabled(p_school_id) then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_phone := public.bot_pay_guardian_phone(p_school_id, p_guardian_user_id);
  if v_phone is null then
    return jsonb_build_object('status', 'not_configured');
  end if;

  select b.balance into v_balance from public.v_student_balances b where b.student_id = p_student_id and b.school_id = p_school_id;
  v_balance := coalesce(v_balance, 0);
  if v_balance <= 0 then
    return jsonb_build_object('status', 'no_balance');
  end if;
  if p_amount is null then
    return jsonb_build_object('status', 'ask_amount', 'balance', v_balance);
  end if;
  if p_amount <> trunc(p_amount) then
    return jsonb_build_object('status', 'not_whole');
  end if;
  if p_amount < 10 then
    return jsonb_build_object('status', 'too_low');
  end if;
  if p_amount > v_balance or p_amount > 150000 then
    return jsonb_build_object('status', 'too_high', 'balance', v_balance);
  end if;

  if not public.increment_and_check_rate_limit('bot-pay-prepare:' || p_guardian_user_id::text, 10, 3600) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update public.bot_pay_requests set status = 'cancelled', updated_at = now()
   where conversation_id = p_conversation_id and status = 'awaiting_confirm';
  insert into public.bot_pay_requests (school_id, conversation_id, guardian_user_id, student_id, amount, expires_at)
  values (p_school_id, p_conversation_id, p_guardian_user_id, p_student_id, p_amount, now() + interval '10 minutes');

  return jsonb_build_object('status', 'awaiting_confirm', 'amount', p_amount, 'balance', v_balance,
                            'phone_last3', right(v_phone, 3));
end
$function$;

-- Step 2: the guardian said YES. Re-checks everything, raises the STK request for the guardian's OWN number.
-- Returns jsonb: status = started (with request_id) | none | expired | forbidden | disabled | not_configured | too_high
--                          | in_progress | rate_limited
create or replace function public.bot_guardian_pay_confirm(p_school_id uuid, p_conversation_id uuid, p_guardian_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.bot_pay_requests%rowtype;
  v_balance numeric;
  v_phone text;
  v_req uuid;
begin
  select * into r from public.bot_pay_requests
   where conversation_id = p_conversation_id and guardian_user_id = p_guardian_user_id and school_id = p_school_id
     and status = 'awaiting_confirm'
   order by created_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  if r.expires_at <= now() then
    update public.bot_pay_requests set status = 'expired', updated_at = now() where id = r.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not public.bot_pay_guardian_linked(p_school_id, p_guardian_user_id, r.student_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not public.bot_pay_enabled(p_school_id) then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_phone := public.bot_pay_guardian_phone(p_school_id, p_guardian_user_id);
  if v_phone is null then
    return jsonb_build_object('status', 'not_configured');
  end if;

  select b.balance into v_balance from public.v_student_balances b where b.student_id = r.student_id and b.school_id = p_school_id;
  if coalesce(v_balance, 0) < r.amount then
    update public.bot_pay_requests set status = 'cancelled', updated_at = now() where id = r.id;
    return jsonb_build_object('status', 'too_high', 'balance', greatest(coalesce(v_balance, 0), 0));
  end if;

  -- One prompt at a time for this learner.
  if exists (
    select 1 from public.bot_pay_requests x join public.mpesa_stk_requests k on k.id = x.stk_request_id
     where x.student_id = r.student_id and x.status = 'started' and k.status = 'pending' and k.initiated_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('status', 'in_progress');
  end if;

  if not public.increment_and_check_rate_limit('bot-pay-confirm:' || p_guardian_user_id::text, 5, 3600)
     or not public.increment_and_check_rate_limit('mpesa-stk-phone:' || v_phone, 5, 3600) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.mpesa_stk_requests (school_id, student_id, invoice_id, amount, phone_number, initiated_by, notes)
  values (p_school_id, r.student_id, null, r.amount, v_phone, null, 'Bot pay')
  returning id into v_req;
  update public.bot_pay_requests set status = 'started', stk_request_id = v_req, updated_at = now() where id = r.id;

  return jsonb_build_object('status', 'started', 'request_id', v_req, 'amount', r.amount);
end
$function$;

-- The guardian said NO (or changed the subject deliberately). True when something was cancelled.
create or replace function public.bot_guardian_pay_cancel(p_school_id uuid, p_conversation_id uuid, p_guardian_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.bot_pay_requests set status = 'cancelled', updated_at = now()
   where conversation_id = p_conversation_id and guardian_user_id = p_guardian_user_id and school_id = p_school_id
     and status = 'awaiting_confirm';
  return found;
end
$function$;

-- WP 1.3b hook: the internal push mode may now also dispatch bot-raised requests. (Pay by Link attempts still allowed.)
create or replace function public.mpesa_stk_internal_dispatch_allowed(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.pay_link_attempts a where a.stk_request_id = p_request_id)
      or exists (select 1 from public.bot_pay_requests b where b.stk_request_id = p_request_id and b.status = 'started');
$function$;

revoke all on function public.bot_pay_enabled(uuid) from public, anon, authenticated;
revoke all on function public.bot_pay_guardian_phone(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.bot_pay_guardian_linked(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.bot_guardian_pay_prepare(uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.bot_guardian_pay_confirm(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.bot_guardian_pay_cancel(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.bot_pay_enabled(uuid) to service_role;
grant execute on function public.bot_guardian_pay_prepare(uuid, uuid, uuid, uuid, numeric) to service_role;
grant execute on function public.bot_guardian_pay_confirm(uuid, uuid, uuid) to service_role;
grant execute on function public.bot_guardian_pay_cancel(uuid, uuid, uuid) to service_role;

-- Rollback: flag off. To remove: drop the six bot_* functions and bot_pay_requests, delete the flag row, and re-run the
-- one-line WP 1.3b version of mpesa_stk_internal_dispatch_allowed (pay_link_attempts only).
