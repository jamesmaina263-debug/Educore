-- Phase 8, Item 13: reversals, not deletions. A correction is recorded as an offsetting
-- transaction — the original payment and its original allocations stay visible in the ledger
-- (brief §4.7: "corrections are recorded as an offsetting reversal transaction; the original
-- stays visible"). No UPDATE/DELETE of amount_allocated is ever used for a correction.

alter table payment_allocations add column entry_type text not null default 'allocation'
  check (entry_type in ('allocation', 'reversal'));
comment on column payment_allocations.entry_type is '''allocation'' rows are money applied to an invoice (amount_allocated > 0, as before). ''reversal'' rows offset a prior allocation (amount_allocated < 0) when a payment is reversed — inserted, never overwriting the original row.';

alter table payment_allocations drop constraint payment_allocations_amount_allocated_check;
alter table payment_allocations add constraint payment_allocations_amount_allocated_check
  check ((entry_type = 'allocation' and amount_allocated > 0) or (entry_type = 'reversal' and amount_allocated < 0));

-- v_student_balances.total_paid already sums payment_allocations.amount_allocated, so a reversal
-- row (negative) nets it down automatically — no formula change needed there, and the existing
-- recompute_invoice_status trigger (fires on payment_allocations insert) already recomputes the
-- affected invoice's status correctly when a reversal lands.

create table payment_reversals (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null,
  reversed_by uuid references school_users(id),
  created_at timestamptz not null default now()
);
comment on table payment_reversals is 'One row per reversal transaction against a payment. Multiple partial reversals against the same payment are allowed as long as their total never exceeds the original payment amount.';

create index payment_reversals_payment_id_idx on payment_reversals (payment_id);

alter table payment_reversals enable row level security;

create policy payment_reversals_select on payment_reversals for select
  using (
    exists (
      select 1 from payments p
      where p.id = payment_reversals.payment_id
        and (
          (p.school_id = auth_school_id() and auth_has_permission('finance.read'))
          or (p.student_id is not null and auth_user_id_is_guardian_of(p.student_id))
          or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = p.student_id and su.auth_user_id = (select auth.uid()))
        )
    )
  );
-- No direct write policy — only reverse_payment() below.

-- Reverses up to p_amount of a payment. The portion that was applied to invoices is pulled back
-- (oldest allocation first) as new negative payment_allocations rows against the same invoices,
-- which pushes their balance back up via the existing recompute trigger. Any remaining reversed
-- amount that was sitting as unapplied credit simply reduces that credit (v_student_balances
-- computes credit from net-received-minus-allocated, so no separate credit ledger row is needed).
create or replace function reverse_payment(p_payment_id uuid, p_amount numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_payment record;
  v_already_reversed numeric;
  v_already_allocated numeric;
  v_to_pull_back numeric;
  v_alloc record;
  v_apply numeric;
  v_actor uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to reverse payments.';
  end if;
  if p_amount <= 0 then
    raise exception 'Reversal amount must be positive.';
  end if;

  select * into v_payment from payments where id = p_payment_id and school_id = v_school_id;
  if v_payment.id is null then
    raise exception 'Payment not found.';
  end if;
  if v_payment.status = 'unallocated' then
    raise exception 'Cannot reverse an unallocated payment — allocate or delete it is not supported; contact support.';
  end if;

  select coalesce(sum(amount), 0) into v_already_reversed from payment_reversals where payment_id = p_payment_id;
  if p_amount > (v_payment.amount - v_already_reversed) then
    raise exception 'Reversal amount exceeds the remaining reversible amount on this payment.';
  end if;

  select id into v_actor from school_users where auth_user_id = auth.uid();

  insert into payment_reversals (payment_id, amount, reason, reversed_by) values (p_payment_id, p_amount, p_reason, v_actor);

  -- How much of THIS payment is currently applied to invoices (allocation rows minus any prior
  -- reversal rows already pulled back), that we can still claw back.
  select coalesce(sum(amount_allocated), 0) into v_already_allocated
    from payment_allocations where payment_id = p_payment_id;
  v_to_pull_back := least(p_amount, greatest(v_already_allocated, 0));

  for v_alloc in
    select invoice_id, amount_allocated from payment_allocations
    where payment_id = p_payment_id and entry_type = 'allocation'
    order by created_at desc
  loop
    exit when v_to_pull_back <= 0;
    v_apply := least(v_to_pull_back, v_alloc.amount_allocated);
    insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
      values (p_payment_id, v_alloc.invoice_id, -v_apply, 'reversal');
    v_to_pull_back := v_to_pull_back - v_apply;
  end loop;

  update payments set status = 'reversed'
    where id = p_payment_id and (v_already_reversed + p_amount) >= amount;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school_id, v_actor, 'payments', p_payment_id, 'reverse', p_reason, jsonb_build_object('amount_reversed', p_amount));
end;
$$;

revoke execute on function reverse_payment(uuid, numeric, text) from public, anon;
grant execute on function reverse_payment(uuid, numeric, text) to authenticated;

-- credit_balance: money received (net of reversals) that hasn't been applied to any invoice —
-- overpayment credit that stays attached to the account (brief §4.7 item 12), never lost, and
-- computed on read like every other balance figure here (never hand-edited).
-- create or replace (not drop+create): v_at_risk_students (an earlier phase) depends on this
-- view, and a bare DROP fails on that dependency. CREATE OR REPLACE is safe here because every
-- existing column (student_id, school_id, stream_id, total_invoiced, total_discounted,
-- total_paid, balance) keeps its exact name, position, and type — credit_balance is only ever
-- appended at the end, which Postgres allows without touching dependent views.
create or replace view v_student_balances
with (security_invoker = true) as
select
  st.id as student_id,
  st.school_id,
  st.current_class_id as stream_id,
  coalesce(inv_totals.total_invoiced, 0) as total_invoiced,
  coalesce(disc_totals.total_discounted, 0) as total_discounted,
  coalesce(pay_totals.total_paid, 0) as total_paid,
  coalesce(inv_totals.total_invoiced, 0) - coalesce(disc_totals.total_discounted, 0) - coalesce(pay_totals.total_paid, 0) as balance,
  greatest(0, coalesce(net_received.total, 0) - coalesce(pay_totals.total_paid, 0)) as credit_balance
from students st
left join lateral (
  select sum(total_amount) as total_invoiced from invoices where student_id = st.id
) inv_totals on true
left join lateral (
  select sum(d.amount) as total_discounted
  from discounts d
  join invoices i on i.id = d.invoice_id
  where i.student_id = st.id and d.status = 'approved'
) disc_totals on true
left join lateral (
  select sum(pa.amount_allocated) as total_paid
  from payment_allocations pa
  join invoices i on i.id = pa.invoice_id
  where i.student_id = st.id
) pay_totals on true
left join lateral (
  select sum(p.amount) - coalesce((select sum(pr.amount) from payment_reversals pr join payments p2 on p2.id = pr.payment_id where p2.student_id = st.id), 0) as total
  from payments p
  where p.student_id = st.id and p.status <> 'unallocated'
) net_received on true;

comment on view v_student_balances is 'Computed-on-read per student. balance = invoiced - discounted(approved) - paid(net of any reversal pull-backs). credit_balance = money received net of reversals that has not been applied to any invoice (overpayment credit, brief §4.7 item 12) — also always computed, never a stored/hand-edited field. security_invoker=true so RLS on every underlying table still applies to the querying role.';
