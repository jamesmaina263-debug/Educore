-- WP 4.3: Refund workflow, DATABASE CORE ONLY. ADDITIVE ONLY, dark behind feature.finance.refunds.
--
-- Adds: one flag catalog row (enabled for nobody), one default permission grant, two tables, two
-- internal helpers and four client functions. Nothing existing is altered: no existing table,
-- function, view, policy, trigger or grant is touched, and the cashbook and v_student_balances are
-- NOT edited.
--
-- Scope of v1 (deliberately narrower than "any payment"): a refund returns MONEY THAT IS HELD AS
-- CREDIT, i.e. the part of a payment not applied to any invoice (overpayment, duplicate payment,
-- paid in error). Refunding fees that were already applied to an invoice needs an invoice
-- adjustment first; that is a separate decision and is NOT built here.
--
-- Accounting: the existing ledger already treats a row in payment_reversals as money going back
-- out (v_student_balances subtracts it from net received; cashbook_lines_internal lists it as money
-- out). A refund therefore adds exactly ONE payment_reversals row and NO payment_allocations row,
-- so invoices and fees paid are untouched and only the learner's credit balance falls. Existing
-- reverse_payment() is NOT reused on purpose: it pulls amounts back off invoices first, which would
-- re-open an invoice and leave the credit unchanged when the money being refunded is credit.
--
-- The ledger changes only when the pay-out is RECORDED (money has really left), in the same
-- transaction as the pay-out row. Request and approval change no balance.
--
-- The system does NOT move money. The pay-out record is entered by a person after they pay out by
-- M-Pesa / bank / cash / cheque outside EduCore.

-- 1. Flag catalog entry (enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.refunds',
       'Refund workflow',
       'Request, approve and record the pay-out of a refund of money held as credit. Records only: the system does not move money. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.refunds'
);

-- 2. Approval permission. Requesting and paying out use the existing finance.write (bursar, owner).
--    Approving needs a separate key so the maker and the checker are different roles by default.
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'finance.refund.approve', true
from public.roles r
where r.name in ('school_owner', 'principal')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'finance.refund.approve'
  );

-- 3. Requests.
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  amount numeric not null check (amount > 0 and amount = trunc(amount)),
  reason_code text not null check (reason_code in ('overpayment', 'duplicate_payment', 'paid_in_error', 'other')),
  reason_note text check (reason_note is null or length(reason_note) <= 500),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled', 'paid')),
  requested_by uuid references public.school_users(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.school_users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reason_code <> 'other' or nullif(btrim(coalesce(reason_note, '')), '') is not null)
);

-- One open request per payment.
create unique index refund_requests_one_open_per_payment
  on public.refund_requests (payment_id) where status in ('requested', 'approved');
create index refund_requests_school_status_idx on public.refund_requests (school_id, status, requested_at desc);
create index refund_requests_student_idx on public.refund_requests (student_id);

create trigger trg_refund_requests_updated_at
  before update on public.refund_requests
  for each row execute function public.set_updated_at();

-- 4. Pay-out records. Append-only: no client write grant at all.
create table public.refund_payouts (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null unique references public.refund_requests(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_reversal_id uuid references public.payment_reversals(id) on delete set null,
  amount numeric not null check (amount > 0 and amount = trunc(amount)),
  method text not null check (method in ('mpesa', 'bank', 'cash', 'cheque')),
  reference text not null check (length(reference) between 1 and 100),
  paid_by uuid references public.school_users(id) on delete set null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index refund_payouts_school_idx on public.refund_payouts (school_id, paid_at desc);

-- 5. RLS: read only, same school with finance.read (or platform super admin). Writes only through
--    the SECURITY DEFINER functions below.
alter table public.refund_requests enable row level security;
alter table public.refund_payouts enable row level security;

create policy refund_requests_select on public.refund_requests
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('finance.read'))
  );

create policy refund_payouts_select on public.refund_payouts
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('finance.read'))
  );

revoke all on table public.refund_requests from anon;
revoke all on table public.refund_payouts from anon;
revoke insert, update, delete, truncate on table public.refund_requests from authenticated;
revoke insert, update, delete, truncate on table public.refund_payouts from authenticated;
grant select on table public.refund_requests to authenticated;
grant select on table public.refund_payouts to authenticated;

-- 6. Internal helper: the part of a payment that is held as credit (not applied to any invoice and
--    not already reversed or refunded). Same arithmetic as v_student_balances.credit_balance.
create or replace function public.refund_payment_available(p_payment_id uuid)
returns numeric
language sql
security definer
set search_path to 'public'
as $function$
  select greatest(0,
    p.amount
    - coalesce((select sum(pa.amount_allocated) from public.payment_allocations pa where pa.payment_id = p.id), 0)
    - coalesce((select sum(r.amount) from public.payment_reversals r where r.payment_id = p.id), 0))
  from public.payments p
  where p.id = p_payment_id;
$function$;

-- 7. Internal helper: raises unless p_amount can be refunded from this payment right now.
create or replace function public.refund_assert_refundable(p_payment_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pay record;
  v_available numeric;
  v_credit numeric;
begin
  select id, student_id, status into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found.';
  end if;
  if v_pay.student_id is null or v_pay.status not in ('confirmed', 'recorded') then
    raise exception 'Only a confirmed or recorded payment that belongs to a learner can be refunded.';
  end if;

  v_available := public.refund_payment_available(p_payment_id);
  if p_amount > v_available then
    raise exception 'Refund exceeds the part of this payment that is held as credit (KES % available).', v_available;
  end if;

  select credit_balance into v_credit from public.v_student_balances where student_id = v_pay.student_id;
  if p_amount > coalesce(v_credit, 0) then
    raise exception 'Refund exceeds the learner''s credit balance (KES % available).', coalesce(v_credit, 0);
  end if;
end;
$function$;

revoke all on function public.refund_payment_available(uuid) from public;
revoke execute on function public.refund_payment_available(uuid) from anon, authenticated;
revoke all on function public.refund_assert_refundable(uuid, numeric) from public;
revoke execute on function public.refund_assert_refundable(uuid, numeric) from anon, authenticated;

-- 8. Step 1: request. Changes no balance.
create or replace function public.create_refund_request(
  p_payment_id uuid,
  p_amount numeric,
  p_reason_code text,
  p_reason_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
  v_student uuid;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to request refunds.';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.refunds') then
    raise exception 'Refunds are not enabled for your school.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'Refund amount must be a whole number of shillings greater than zero.';
  end if;
  if p_reason_code is null or p_reason_code not in ('overpayment', 'duplicate_payment', 'paid_in_error', 'other') then
    raise exception 'Choose a valid refund reason.';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'Describe the reason for this refund.';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'The reason note is too long (500 characters at most).';
  end if;

  select student_id into v_student from public.payments where id = p_payment_id and school_id = v_school;
  if not found then
    raise exception 'Payment not found.';
  end if;
  if v_student is null then
    raise exception 'Only a confirmed or recorded payment that belongs to a learner can be refunded.';
  end if;

  perform pg_advisory_xact_lock(hashtext('student_payments:' || v_student::text));
  perform public.refund_assert_refundable(p_payment_id, p_amount);

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  begin
    insert into public.refund_requests (school_id, payment_id, student_id, amount, reason_code, reason_note, requested_by)
    values (v_school, p_payment_id, v_student, p_amount, p_reason_code, v_note, v_actor)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'This payment already has a refund request in progress.';
  end;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school, v_actor, 'refund_requests', v_id, 'create', v_note,
          jsonb_build_object('payment_id', p_payment_id, 'student_id', v_student, 'amount', p_amount, 'reason_code', p_reason_code));

  return v_id;
end;
$function$;

-- 9. Step 2: approve or reject. Changes no balance. When another person with approval rights
--    exists, the requester cannot approve their own request; in a school where they are the only
--    approver self-approval is allowed and is flagged in the audit log.
create or replace function public.decide_refund_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
  v_req public.refund_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_self boolean;
begin
  if v_school is null or not auth_has_permission('finance.refund.approve') then
    raise exception 'Not authorized to decide refund requests.';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.refunds') then
    raise exception 'Refunds are not enabled for your school.';
  end if;
  if p_approve is null then
    raise exception 'Choose approve or reject.';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'The note is too long (500 characters at most).';
  end if;

  select * into v_req from public.refund_requests where id = p_request_id and school_id = v_school for update;
  if not found then
    raise exception 'Refund request not found.';
  end if;
  if v_req.status <> 'requested' then
    raise exception 'This refund request has already been decided.';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();
  v_self := v_req.requested_by is not distinct from v_actor;

  if p_approve then
    if v_self and public.two_person_other_approver_exists(v_school, v_actor, 'finance.refund.approve') then
      raise exception 'You requested this refund, so someone else with approval rights needs to approve it.';
    end if;
    perform public.refund_assert_refundable(v_req.payment_id, v_req.amount);
  elsif v_note is null then
    raise exception 'Give a reason for rejecting this request.';
  end if;

  update public.refund_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_actor, decided_at = now(), decision_note = v_note
   where id = v_req.id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school, v_actor, 'refund_requests', v_req.id, case when p_approve then 'approve' else 'reject' end, v_note,
          jsonb_build_object('amount', v_req.amount, 'self_approved', p_approve and v_self));
end;
$function$;

-- 10. Cancel a request that has not been paid out. Changes no balance.
create or replace function public.cancel_refund_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
  v_req public.refund_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to cancel refund requests.';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.refunds') then
    raise exception 'Refunds are not enabled for your school.';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'The note is too long (500 characters at most).';
  end if;

  select * into v_req from public.refund_requests where id = p_request_id and school_id = v_school for update;
  if not found then
    raise exception 'Refund request not found.';
  end if;
  if v_req.status not in ('requested', 'approved') then
    raise exception 'Only a request that has not been paid out can be cancelled.';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.refund_requests set status = 'cancelled', decision_note = coalesce(v_note, decision_note) where id = v_req.id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school, v_actor, 'refund_requests', v_req.id, 'cancel', v_note, jsonb_build_object('amount', v_req.amount));
end;
$function$;

-- 11. Step 3: record the pay-out. This is the only step that changes a balance: it adds ONE
--     payment_reversals row (money out) and the pay-out record, atomically. No allocation is touched.
create or replace function public.record_refund_payout(
  p_request_id uuid,
  p_method text,
  p_reference text,
  p_paid_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
  v_student uuid;
  v_req public.refund_requests%rowtype;
  v_ref text := btrim(coalesce(p_reference, ''));
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_reversal uuid;
  v_payout uuid;
  v_total_reversed numeric;
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to record refund pay-outs.';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.refunds') then
    raise exception 'Refunds are not enabled for your school.';
  end if;
  if p_method is null or p_method not in ('mpesa', 'bank', 'cash', 'cheque') then
    raise exception 'Choose how the refund was paid.';
  end if;
  if length(v_ref) < 1 or length(v_ref) > 100 then
    raise exception 'Enter the payment reference (M-Pesa code, bank reference, voucher or cheque number).';
  end if;
  if v_paid_at > now() + interval '5 minutes' then
    raise exception 'The pay-out date cannot be in the future.';
  end if;

  -- Same lock order as the other money paths: the learner's payment lock first, then the row lock.
  select student_id into v_student from public.refund_requests where id = p_request_id and school_id = v_school;
  if not found then
    raise exception 'Refund request not found.';
  end if;
  perform pg_advisory_xact_lock(hashtext('student_payments:' || v_student::text));

  select * into v_req from public.refund_requests where id = p_request_id and school_id = v_school for update;
  if v_req.status <> 'approved' then
    raise exception 'Only an approved refund can be paid out.';
  end if;

  -- Re-check against the ledger as it is now (an allocation may have changed since approval).
  perform public.refund_assert_refundable(v_req.payment_id, v_req.amount);

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  insert into public.payment_reversals (payment_id, amount, reason, reversed_by)
  values (v_req.payment_id, v_req.amount,
          'Refund (' || v_req.reason_code || ')' || coalesce(': ' || v_req.reason_note, ''),
          v_actor)
  returning id into v_reversal;

  select coalesce(sum(amount), 0) into v_total_reversed from public.payment_reversals where payment_id = v_req.payment_id;
  update public.payments set status = 'reversed'
   where id = v_req.payment_id and v_total_reversed >= amount;

  insert into public.refund_payouts (refund_request_id, school_id, payment_reversal_id, amount, method, reference, paid_by, paid_at)
  values (v_req.id, v_school, v_reversal, v_req.amount, p_method, v_ref, v_actor, v_paid_at)
  returning id into v_payout;

  update public.refund_requests set status = 'paid' where id = v_req.id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school, v_actor, 'refund_requests', v_req.id, 'refund_paid', v_req.reason_note,
          jsonb_build_object('amount', v_req.amount, 'method', p_method, 'reference', v_ref,
                             'payment_id', v_req.payment_id, 'payment_reversal_id', v_reversal));
  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school, v_actor, 'payments', v_req.payment_id, 'reverse', 'Refund paid out',
          jsonb_build_object('amount_reversed', v_req.amount, 'refund_request_id', v_req.id));

  return v_payout;
end;
$function$;

-- 12. Grants: signed-in users only (each function checks permission and flag itself); never anon.
revoke all on function public.create_refund_request(uuid, numeric, text, text) from public;
revoke execute on function public.create_refund_request(uuid, numeric, text, text) from anon;
grant execute on function public.create_refund_request(uuid, numeric, text, text) to authenticated;

revoke all on function public.decide_refund_request(uuid, boolean, text) from public;
revoke execute on function public.decide_refund_request(uuid, boolean, text) from anon;
grant execute on function public.decide_refund_request(uuid, boolean, text) to authenticated;

revoke all on function public.cancel_refund_request(uuid, text) from public;
revoke execute on function public.cancel_refund_request(uuid, text) from anon;
grant execute on function public.cancel_refund_request(uuid, text) to authenticated;

revoke all on function public.record_refund_payout(uuid, text, text, timestamptz) from public;
revoke execute on function public.record_refund_payout(uuid, text, text, timestamptz) from anon;
grant execute on function public.record_refund_payout(uuid, text, text, timestamptz) to authenticated;
