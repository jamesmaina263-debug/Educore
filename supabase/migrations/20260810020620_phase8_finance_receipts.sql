-- Phase 8, Item 14: Receipts. The brief says "reuse existing receipt infrastructure — one
-- receipt system, not two." Audited first (per phase-gate protocol) and confirmed: no receipt
-- table, number sequence, or generation function exists anywhere in the codebase today — only a
-- free-text `reference` column on `payments` for an M-Pesa/cheque/bank reference the payer
-- already has, and a `receipt_url` column on the unrelated `expenses` table for an uploaded
-- vendor receipt. Neither is "receipt infrastructure" for a payment made TO the school.
-- Flagging this rather than silently building a second one anyway: this migration creates the
-- one receipt system that should exist going forward — every payment (manual today, API-sourced
-- later) generates through this single path, so there is never a second one to reconcile against.

create sequence if not exists receipt_number_seq;

create table receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null unique references payments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  receipt_number text not null,
  issued_at timestamptz not null default now(),
  unique (school_id, receipt_number)
);
comment on table receipts is 'One receipt per confirmed, student-allocated payment (unique on payment_id — never a second receipt for the same payment, satisfying "one receipt system, not two"). Generated automatically by generate_receipt(), called from record_payment() and allocate_unallocated_payment().';

create index receipts_student_id_idx on receipts (student_id);
create index receipts_school_id_idx on receipts (school_id);

alter table receipts enable row level security;

create policy receipts_select on receipts for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(receipts.student_id)
    or exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where st.id = receipts.student_id and su.auth_user_id = (select auth.uid())
    )
  );
-- No direct write policy — only generate_receipt() below.

-- Idempotent: a payment that already has a receipt just returns it (covers a retried call from
-- record_payment/allocate_unallocated_payment, e.g. after a partial failure elsewhere). Only
-- ever called for payments that have a student attached (never for an unallocated payment,
-- which by definition has no student to receipt yet).
create or replace function generate_receipt(p_payment_id uuid)
returns receipts
language plpgsql security definer set search_path = public as $$
declare
  v_receipt receipts;
  v_school_id uuid;
  v_student_id uuid;
  v_number text;
begin
  select * into v_receipt from receipts where payment_id = p_payment_id;
  if v_receipt.id is not null then
    return v_receipt;
  end if;

  select school_id, student_id into v_school_id, v_student_id from payments where id = p_payment_id;
  if v_student_id is null then
    return null; -- unallocated payment: nothing to receipt yet
  end if;

  v_number := 'RCT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('receipt_number_seq')::text, 6, '0');

  insert into receipts (school_id, payment_id, student_id, receipt_number)
  values (v_school_id, p_payment_id, v_student_id, v_number)
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke execute on function generate_receipt(uuid) from public, anon;
grant execute on function generate_receipt(uuid) to authenticated;
