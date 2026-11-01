-- Phase 1.2 (database half): "check any M-Pesa code" lookup for Finance > Reconciliation.
-- ADDITIVE ONLY: one new read-only function. No table, policy, trigger, grant or existing function is touched.
--
-- Answers, for ONE M-Pesa receipt code typed by finance staff: is it recorded as a payment, did it
-- appear on an uploaded statement, did the paybill auto-capture (C2B) pipeline receive it, and what is
-- the verdict. Own school only; finance.read required; never writes anything.
-- C2B events are included only when feature.finance.c2b_capture is on for the caller's school.
--
-- Rollback: nothing calls this until the UI PR merges. To remove: drop function public.check_mpesa_code(text);

create or replace function public.check_mpesa_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid;
  v_code text;
  v_c2b_on boolean;
  v_payments jsonb;
  v_lines jsonb;
  v_events jsonb;
  v_verdict text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  v_school := public.auth_school_id();
  if v_school is null or not public.auth_has_permission('finance.read') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if v_code !~ '^[A-Z0-9]{8,16}$' then
    raise exception 'Enter the M-Pesa code exactly as it appears in the SMS (8 to 16 letters and digits).' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id,
           'amount', p.amount,
           'status', p.status,
           'source', p.source,
           'recorded_at', p.recorded_at,
           'student_id', p.student_id,
           'student_name', nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''),
           'admission_number', s.admission_number
         ) order by p.recorded_at), '[]'::jsonb)
    into v_payments
    from public.payments p
    left join public.students s on s.id = p.student_id and s.school_id = p.school_id
   where p.school_id = v_school
     and p.method = 'mpesa'
     and p.reference is not null
     and upper(regexp_replace(p.reference, '\s', '', 'g')) = v_code;

  select coalesce(jsonb_agg(jsonb_build_object(
           'amount', l.amount,
           'match_status', l.match_status,
           'transaction_time', l.transaction_time,
           'matched_payment_id', l.matched_payment_id,
           'uploaded_at', l.created_at
         ) order by l.created_at), '[]'::jsonb)
    into v_lines
    from public.mpesa_statement_lines l
   where l.school_id = v_school
     and upper(regexp_replace(l.receipt_no, '\s', '', 'g')) = v_code;

  v_c2b_on := coalesce(public.school_has_feature_flag(v_school, 'feature.finance.c2b_capture'), false);
  if v_c2b_on then
    select coalesce(jsonb_agg(jsonb_build_object(
             'amount', e.amount,
             'outcome', e.outcome,
             'match_rule', e.match_rule,
             'transaction_time', e.transaction_time,
             'payment_id', e.payment_id,
             'received_at', e.created_at
           ) order by e.created_at), '[]'::jsonb)
      into v_events
      from public.inbound_payment_events e
     where e.school_id = v_school
       and upper(regexp_replace(e.external_id, '\s', '', 'g')) = v_code;
  else
    v_events := '[]'::jsonb;
  end if;

  v_verdict := case
    when jsonb_array_length(v_payments) > 0 then 'recorded'
    when jsonb_array_length(v_lines) > 0 or jsonb_array_length(v_events) > 0 then 'seen_not_recorded'
    else 'not_found'
  end;

  return jsonb_build_object(
    'code', v_code,
    'verdict', v_verdict,
    'payments', v_payments,
    'statement_lines', v_lines,
    'c2b_events', v_events,
    'c2b_checked', v_c2b_on
  );
end;
$function$;

revoke execute on function public.check_mpesa_code(text) from public, anon;
grant execute on function public.check_mpesa_code(text) to authenticated;

comment on function public.check_mpesa_code(text) is
  'Read-only lookup of one M-Pesa receipt code for the caller''s own school (finance.read): payments, statement lines and, when the C2B flag is on, C2B events. Verdict: recorded | seen_not_recorded | not_found. Never writes.';
