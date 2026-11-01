-- Phase 1.1a (gap-closure plan): C2B paybill auto-capture, DATABASE CORE ONLY. ADDITIVE ONLY.
--
-- Adds: one flag catalog row (not enabled for anyone), one per-school config table, one inbound
-- payment events table, four service_role-only functions. Nothing existing is altered: no existing
-- table, function, policy, trigger or grant is touched. No edge function exists yet and nothing is
-- registered with Safaricom, so nothing can call these functions until a later PR ships.
--
-- Safety posture:
--   * The flag `feature.finance.c2b_capture` is off for every school (no school_feature_flags row).
--   * Even with the flag on, a school's mode defaults to 'log_only': events are recorded and the
--     match that WOULD have been made is shown, but no payment, allocation or receipt is created.
--   * Idempotency key is (school_id, provider, external_id) on the events table, which -- unlike the
--     payments reference index -- also holds for reversed payments.
--   * Matching never guesses: exact admission number, or a typo repair (O/0, I/L/1, leading zeros)
--     only when it yields exactly one learner. Anything else becomes an unallocated payment.
--   * An STK push to the same paybill can also produce a C2B notification for the same M-Pesa
--     receipt. If a payment with that reference already exists the event is a 'duplicate'; if a
--     matching STK request is still pending it is 'deferred_to_stk' and c2b_resolve_deferred_events()
--     later records anything the STK path did not.

-- 1. Flag catalog entry (visible in admin, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.c2b_capture',
       'M-Pesa paybill (C2B) auto-capture',
       'Captures paybill payments automatically by admission number. Off by default. Even when on, a school stays in log-only mode until its mode is set to live.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.c2b_capture'
);

-- 2. Per-school config. Holds the URL secret, so no policies at all: only service_role and the
--    SECURITY DEFINER functions below can read it. No audit trigger on purpose: audit_row_change()
--    only redacts a column named callback_token and would copy confirmation_token into audit_log.
create table public.mpesa_c2b_config (
  school_id uuid primary key references public.schools(id) on delete cascade,
  confirmation_token text not null default encode(gen_random_bytes(24), 'hex'),
  mode text not null default 'log_only' check (mode in ('log_only', 'live')),
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mpesa_c2b_config enable row level security;
revoke all on table public.mpesa_c2b_config from anon, authenticated;

create trigger trg_mpesa_c2b_config_updated_at
  before update on public.mpesa_c2b_config
  for each row execute function public.set_updated_at();

-- 3. Inbound payment events (all providers). Append-mostly log of every notification received.
create table public.inbound_payment_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  provider text not null check (provider in ('mpesa_c2b', 'coop_ins')),
  external_id text not null check (length(external_id) between 1 and 100),
  amount numeric not null check (amount > 0),
  account_reference text,
  phone_masked text,
  transaction_time timestamptz,
  outcome text not null default 'received' check (outcome in (
    'received', 'log_only', 'allocated', 'unallocated', 'duplicate', 'deferred_to_stk', 'failed'
  )),
  match_rule text check (match_rule in ('exact', 'typo_repair', 'ambiguous', 'none')),
  student_id uuid references public.students(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (school_id, provider, external_id)
);

create index inbound_payment_events_school_created_idx on public.inbound_payment_events (school_id, created_at desc);
create index inbound_payment_events_payment_idx on public.inbound_payment_events (payment_id) where payment_id is not null;
create index inbound_payment_events_student_idx on public.inbound_payment_events (student_id) where student_id is not null;
create index inbound_payment_events_deferred_idx on public.inbound_payment_events (created_at) where outcome = 'deferred_to_stk';

alter table public.inbound_payment_events enable row level security;

create policy inbound_payment_events_select on public.inbound_payment_events
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('finance.read'))
  );

revoke all on table public.inbound_payment_events from anon;
revoke insert, update, delete, truncate on table public.inbound_payment_events from authenticated;
grant select on table public.inbound_payment_events to authenticated;

-- 4. Pure text helpers for matching.
create or replace function public.c2b_normalize_ref(p_ref text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select upper(regexp_replace(coalesce(p_ref, ''), '[\s-]+', '', 'g'));
$function$;

-- Canonical form used ONLY for typo repair: letter O -> 0, letters I and L -> 1, and leading zeros
-- dropped when the whole reference is digits. Deliberately nothing broader.
create or replace function public.c2b_canonical_ref(p_ref text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when translate(upper(coalesce(p_ref, '')), 'OIL', '011') ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(translate(upper(coalesce(p_ref, '')), 'OIL', '011'), '0'), ''), '0')
    else translate(upper(coalesce(p_ref, '')), 'OIL', '011')
  end;
$function$;

-- 5. Core processor. Decides what an event should become and, only for a live school with the flag
--    on, records it. Safe to call again on an event that is already final (returns it unchanged).
create or replace function public.c2b_process_event(p_event_id uuid, p_allow_defer boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ev public.inbound_payment_events%rowtype;
  v_flag_key text;
  v_flag boolean;
  v_mode text;
  v_method text;
  v_norm text;
  v_ids uuid[];
  v_cnt integer;
  v_student uuid;
  v_rule text := 'none';
  v_plan text;
  v_payment_id uuid;
  v_outstanding numeric;
  v_remaining numeric;
  v_apply numeric;
  v_invoice record;
  v_outcome text;
  v_notes text;
  v_note_ref text;
begin
  select * into v_ev from public.inbound_payment_events where id = p_event_id for update;
  if not found then
    raise exception 'Inbound payment event not found.';
  end if;

  -- Only 'received' and 'deferred_to_stk' events are still open.
  if v_ev.outcome not in ('received', 'deferred_to_stk') then
    return jsonb_build_object('event_id', v_ev.id, 'outcome', v_ev.outcome, 'payment_id', v_ev.payment_id,
      'match_rule', v_ev.match_rule, 'student_id', v_ev.student_id, 'duplicate', true);
  end if;

  v_method := case v_ev.provider when 'mpesa_c2b' then 'mpesa' else 'bank' end;
  v_flag_key := case v_ev.provider when 'mpesa_c2b' then 'feature.finance.c2b_capture' else 'feature.finance.bank_notifications' end;
  v_flag := coalesce(public.school_has_feature_flag(v_ev.school_id, v_flag_key), false);
  v_mode := coalesce((select mode from public.mpesa_c2b_config where school_id = v_ev.school_id), 'log_only');

  -- Matching (always computed, so log-only shows what would happen).
  v_norm := public.c2b_normalize_ref(v_ev.account_reference);
  if v_norm <> '' then
    select array_agg(id) into v_ids from public.students
      where school_id = v_ev.school_id and admission_number is not null
        and public.c2b_normalize_ref(admission_number) = v_norm;
    v_cnt := coalesce(array_length(v_ids, 1), 0);
    if v_cnt = 1 then
      v_student := v_ids[1]; v_rule := 'exact';
    elsif v_cnt > 1 then
      v_rule := 'ambiguous';
    else
      select array_agg(id) into v_ids from public.students
        where school_id = v_ev.school_id and admission_number is not null
          and public.c2b_canonical_ref(public.c2b_normalize_ref(admission_number)) = public.c2b_canonical_ref(v_norm);
      v_cnt := coalesce(array_length(v_ids, 1), 0);
      if v_cnt = 1 then
        v_student := v_ids[1]; v_rule := 'typo_repair';
      elsif v_cnt > 1 then
        v_rule := 'ambiguous';
      end if;
    end if;
  end if;

  -- Plan.
  if exists (select 1 from public.payments
             where school_id = v_ev.school_id and method = v_method and reference = v_ev.external_id) then
    v_plan := 'duplicate';
  elsif p_allow_defer and v_ev.provider = 'mpesa_c2b' and exists (
      select 1 from public.mpesa_stk_requests
      where school_id = v_ev.school_id and status = 'pending'
        and abs(amount - v_ev.amount) < 0.01
        and initiated_at > now() - interval '15 minutes') then
    v_plan := 'deferred_to_stk';
  elsif v_student is not null then
    v_plan := 'allocate';
  else
    v_plan := 'unallocated';
  end if;

  -- Gate: flag off or log-only mode records the event and the would-be plan, and stops.
  -- An event already accepted in live mode and deferred is allowed to finish regardless.
  if v_ev.outcome <> 'deferred_to_stk' and (not v_flag or v_mode <> 'live') then
    update public.inbound_payment_events
      set outcome = 'log_only', match_rule = v_rule, student_id = v_student,
          notes = left('would_be=' || v_plan || '; ' || case when not v_flag then 'flag_off' else 'mode_log_only' end, 500)
      where id = v_ev.id;
    return jsonb_build_object('event_id', v_ev.id, 'outcome', 'log_only', 'payment_id', null,
      'match_rule', v_rule, 'student_id', v_student, 'would_be', v_plan, 'duplicate', false);
  end if;

  v_note_ref := left('Paybill account reference: ' || coalesce(nullif(v_ev.account_reference, ''), '(none)') || '; match=' || v_rule, 300);

  if v_plan = 'duplicate' then
    update public.inbound_payment_events
      set outcome = 'duplicate', match_rule = v_rule, student_id = v_student,
          payment_id = (select id from public.payments where school_id = v_ev.school_id and method = v_method and reference = v_ev.external_id limit 1),
          notes = 'payment_with_same_reference_exists'
      where id = v_ev.id;
    return jsonb_build_object('event_id', v_ev.id, 'outcome', 'duplicate', 'payment_id',
      (select payment_id from public.inbound_payment_events where id = v_ev.id),
      'match_rule', v_rule, 'student_id', v_student, 'duplicate', false);
  end if;

  if v_plan = 'deferred_to_stk' then
    update public.inbound_payment_events
      set outcome = 'deferred_to_stk', match_rule = v_rule, student_id = v_student,
          notes = 'waiting_for_matching_stk_confirmation'
      where id = v_ev.id;
    return jsonb_build_object('event_id', v_ev.id, 'outcome', 'deferred_to_stk', 'payment_id', null,
      'match_rule', v_rule, 'student_id', v_student, 'duplicate', false);
  end if;

  -- Record the payment. A concurrent insert of the same reference (for example the STK path) is a
  -- legitimate duplicate, not an error.
  begin
    if v_plan = 'allocate' then
      perform pg_advisory_xact_lock(hashtext('student_payments:' || v_student::text));
      perform public.ensure_student_financial_account_for_webhook(v_student);

      select coalesce(sum(
        total_amount
          - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0)
      ), 0) into v_outstanding
      from public.invoices
      where student_id = v_student and school_id = v_ev.school_id and status != 'paid';

      if v_outstanding <= 0 then
        insert into public.payments (school_id, student_id, method, amount, reference, phone_number, recorded_by, status, source, external_provider, notes)
        values (v_ev.school_id, v_student, v_method, v_ev.amount, v_ev.external_id, v_ev.phone_masked, null, 'unallocated', 'api', v_ev.provider,
                v_note_ref || '; no_outstanding_invoice_yet')
        returning id into v_payment_id;
        v_outcome := 'unallocated';
        v_notes := 'matched_' || v_rule || '; no_outstanding_invoice_yet';
      else
        insert into public.payments (school_id, student_id, method, amount, reference, phone_number, recorded_by, status, source, external_provider, notes)
        values (v_ev.school_id, v_student, v_method, v_ev.amount, v_ev.external_id, v_ev.phone_masked, null, 'confirmed', 'api', v_ev.provider, v_note_ref)
        returning id into v_payment_id;

        v_remaining := v_ev.amount;
        for v_invoice in
          select id, total_amount,
            total_amount - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
              - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
          from public.invoices
          where student_id = v_student and school_id = v_ev.school_id and status != 'paid'
          order by created_at asc
        loop
          exit when v_remaining <= 0;
          if v_invoice.outstanding <= 0 then continue; end if;
          v_apply := least(v_remaining, v_invoice.outstanding);
          insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
            values (v_payment_id, v_invoice.id, v_apply, 'allocation');
          v_remaining := v_remaining - v_apply;
        end loop;

        perform public.generate_receipt(v_payment_id);
        v_outcome := 'allocated';
        v_notes := 'matched_' || v_rule;
      end if;
    else
      insert into public.payments (school_id, student_id, method, amount, reference, phone_number, recorded_by, status, source, external_provider, notes)
      values (v_ev.school_id, null, v_method, v_ev.amount, v_ev.external_id, v_ev.phone_masked, null, 'unallocated', 'api', v_ev.provider,
              v_note_ref || '; no_unique_learner_match')
      returning id into v_payment_id;
      v_outcome := 'unallocated';
      v_notes := 'no_unique_learner_match: ' || v_rule;
    end if;

    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_ev.school_id, null, 'payments', v_payment_id, 'create',
      jsonb_build_object('source', 'inbound_payment_event', 'event_id', v_ev.id, 'provider', v_ev.provider,
        'method', v_method, 'amount', v_ev.amount, 'reference', v_ev.external_id,
        'match_rule', v_rule, 'student_id', v_student, 'outcome', v_outcome));
  exception
    when unique_violation then
      update public.inbound_payment_events
        set outcome = 'duplicate', match_rule = v_rule, student_id = v_student,
            payment_id = (select id from public.payments where school_id = v_ev.school_id and method = v_method and reference = v_ev.external_id limit 1),
            notes = 'concurrent_insert_same_reference'
        where id = v_ev.id;
      return jsonb_build_object('event_id', v_ev.id, 'outcome', 'duplicate',
        'payment_id', (select payment_id from public.inbound_payment_events where id = v_ev.id),
        'match_rule', v_rule, 'student_id', v_student, 'duplicate', false);
  end;

  update public.inbound_payment_events
    set outcome = v_outcome, match_rule = v_rule, student_id = v_student, payment_id = v_payment_id, notes = left(v_notes, 500)
    where id = v_ev.id;

  return jsonb_build_object('event_id', v_ev.id, 'outcome', v_outcome, 'payment_id', v_payment_id,
    'match_rule', v_rule, 'student_id', v_student, 'duplicate', false);
end;
$function$;

-- 6. Entry point for the future edge function. Never throws away a notification: the event row is
--    written first and survives a later failure, which is then recorded as outcome 'failed'.
create or replace function public.c2b_ingest_payment(
  p_school_id uuid,
  p_provider text,
  p_external_id text,
  p_amount numeric,
  p_account_reference text default null,
  p_phone_masked text default null,
  p_transaction_time timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ext text := upper(btrim(coalesce(p_external_id, '')));
  v_id uuid;
  v_existing public.inbound_payment_events%rowtype;
begin
  if p_school_id is null or not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found.';
  end if;
  if p_provider is null or p_provider not in ('mpesa_c2b', 'coop_ins') then
    raise exception 'Unsupported provider.';
  end if;
  if v_ext = '' or length(v_ext) > 100 then
    raise exception 'Invalid external id.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount.';
  end if;

  perform pg_advisory_xact_lock(hashtext('c2b_event:' || p_school_id::text || ':' || p_provider || ':' || v_ext));

  insert into public.inbound_payment_events (school_id, provider, external_id, amount, account_reference, phone_masked, transaction_time, outcome)
  values (p_school_id, p_provider, v_ext, p_amount,
          nullif(left(btrim(coalesce(p_account_reference, '')), 100), ''),
          nullif(left(coalesce(p_phone_masked, ''), 30), ''),
          p_transaction_time, 'received')
  on conflict (school_id, provider, external_id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from public.inbound_payment_events
      where school_id = p_school_id and provider = p_provider and external_id = v_ext;
    return jsonb_build_object('event_id', v_existing.id, 'outcome', v_existing.outcome, 'payment_id', v_existing.payment_id,
      'match_rule', v_existing.match_rule, 'student_id', v_existing.student_id, 'duplicate', true);
  end if;

  begin
    return public.c2b_process_event(v_id, true);
  exception
    when others then
      update public.inbound_payment_events
        set outcome = 'failed', notes = left('processing_error: ' || sqlerrm, 500)
        where id = v_id;
      return jsonb_build_object('event_id', v_id, 'outcome', 'failed', 'payment_id', null,
        'match_rule', null, 'student_id', null, 'duplicate', false);
  end;
end;
$function$;

-- 7. Resolves events deferred to a pending STK request that never recorded the money itself.
create or replace function public.c2b_resolve_deferred_events(p_min_age interval default interval '20 minutes')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.inbound_payment_events
    where outcome = 'deferred_to_stk' and created_at < now() - p_min_age
    order by created_at asc
    limit 200
  loop
    begin
      perform public.c2b_process_event(v_id, false);
      v_count := v_count + 1;
    exception
      when others then
        update public.inbound_payment_events
          set outcome = 'failed', notes = left('resolve_error: ' || sqlerrm, 500)
          where id = v_id;
    end;
  end loop;
  return v_count;
end;
$function$;

-- 8. Grants: service_role only, for every new function.
revoke all on function public.c2b_normalize_ref(text) from public;
revoke execute on function public.c2b_normalize_ref(text) from anon, authenticated;
grant execute on function public.c2b_normalize_ref(text) to service_role;

revoke all on function public.c2b_canonical_ref(text) from public;
revoke execute on function public.c2b_canonical_ref(text) from anon, authenticated;
grant execute on function public.c2b_canonical_ref(text) to service_role;

revoke all on function public.c2b_process_event(uuid, boolean) from public;
revoke execute on function public.c2b_process_event(uuid, boolean) from anon, authenticated;
grant execute on function public.c2b_process_event(uuid, boolean) to service_role;

revoke all on function public.c2b_ingest_payment(uuid, text, text, numeric, text, text, timestamptz) from public;
revoke execute on function public.c2b_ingest_payment(uuid, text, text, numeric, text, text, timestamptz) from anon, authenticated;
grant execute on function public.c2b_ingest_payment(uuid, text, text, numeric, text, text, timestamptz) to service_role;

revoke all on function public.c2b_resolve_deferred_events(interval) from public;
revoke execute on function public.c2b_resolve_deferred_events(interval) from anon, authenticated;
grant execute on function public.c2b_resolve_deferred_events(interval) to service_role;
