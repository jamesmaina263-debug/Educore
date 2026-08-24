-- Finance > Reconciliation: lets a bursar paste/upload a Safaricom Paybill statement (CSV/xlsx)
-- and have every "paid in" line matched against payments already recorded in the system by
-- M-Pesa receipt number. Answers "did every shilling on the statement make it into the system,
-- and does every M-Pesa payment in the system actually appear on the statement" -- today that
-- check only exists as a one-code-at-a-time manual search (searchStudentAccountsAction).
--
-- Deliberately not touching payments/payment_allocations at all: this is a read-side comparison
-- tool. A "not_in_system" line means money the school received that hasn't been recorded yet --
-- the bursar records it themselves via the existing Record Payment / Unallocated Payment flow
-- (prefilled with the receipt no. and amount from this batch), same as any other payment.

create table public.mpesa_statement_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  uploaded_by uuid references public.school_users(id),
  source_label text,
  total_lines integer not null default 0,
  matched_count integer not null default 0,
  mismatched_count integer not null default 0,
  not_in_system_count integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.mpesa_statement_batches is 'One row per uploaded/pasted M-Pesa Paybill statement, for reconciliation against payments already recorded in the system (Finance > Reconciliation). Count columns are a denormalized summary of the batch''s mpesa_statement_lines, set once by import_mpesa_statement().';

create table public.mpesa_statement_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mpesa_statement_batches(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  receipt_no text not null,
  transaction_time timestamptz,
  details text,
  amount numeric(10,2) not null,
  match_status text not null check (match_status in ('matched', 'amount_mismatch', 'not_in_system')),
  matched_payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.mpesa_statement_lines is 'One row per "paid in" transaction line in an uploaded M-Pesa statement. matched_payment_id links to the payments row with the same reference (M-Pesa receipt no.) when found. match_status: matched = same receipt no. and amount already recorded; amount_mismatch = receipt no. found but the recorded amount differs from the statement; not_in_system = money received on the statement that has no matching payment recorded at all yet.';

alter table public.mpesa_statement_batches enable row level security;
alter table public.mpesa_statement_lines enable row level security;

create index mpesa_statement_batches_school_id_created_at_idx on public.mpesa_statement_batches (school_id, created_at desc);
create index mpesa_statement_lines_batch_id_idx on public.mpesa_statement_lines (batch_id);
create index mpesa_statement_lines_school_id_receipt_no_idx on public.mpesa_statement_lines (school_id, receipt_no);
create index mpesa_statement_lines_matched_payment_id_idx on public.mpesa_statement_lines (matched_payment_id);

create policy mpesa_statement_batches_select_staff on public.mpesa_statement_batches for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
create policy mpesa_statement_lines_select_staff on public.mpesa_statement_lines for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
-- No direct write policy on either table -- rows are only ever created via
-- import_mpesa_statement() (security definer), same pattern as payments/record_payment().

-- p_lines: jsonb array of {receipt_no, transaction_time, details, amount}, already filtered
-- client-side to "paid in" rows only (withdrawals/charges on the same statement are not income
-- and are skipped before this is called). Matching is by (school_id, method='mpesa', reference)
-- case/whitespace-insensitive exact match, same identifier a parent/bursar already quotes for
-- recon today. A payment already claimed by an earlier line in *this or any* batch (matched or
-- amount_mismatch) is not matched again, so re-uploading the same statement twice doesn't
-- silently re-match everything -- the second upload's lines all correctly come back
-- not_in_system, since the receipt is already accounted for.
create or replace function public.import_mpesa_statement(p_lines jsonb, p_source_label text default null)
returns table(batch_id uuid, total_lines integer, matched_count integer, mismatched_count integer, not_in_system_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_uploaded_by uuid;
  v_batch_id uuid;
  v_line jsonb;
  v_receipt text;
  v_amount numeric;
  v_time timestamptz;
  v_details text;
  v_payment_id uuid;
  v_payment_amount numeric;
  v_status text;
  v_matched int := 0;
  v_mismatched int := 0;
  v_not_in_system int := 0;
  v_total int := 0;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to import M-Pesa statements.';
  end if;

  select id into v_uploaded_by from school_users where auth_user_id = auth.uid();

  insert into mpesa_statement_batches (school_id, uploaded_by, source_label)
  values (v_school_id, v_uploaded_by, p_source_label)
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_receipt := nullif(trim(v_line->>'receipt_no'), '');
    v_details := v_line->>'details';
    begin
      v_amount := (v_line->>'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    begin
      v_time := nullif(v_line->>'transaction_time', '')::timestamptz;
    exception when others then
      v_time := null;
    end;

    if v_receipt is null or v_amount is null or v_amount <= 0 then
      continue;
    end if;
    v_total := v_total + 1;

    select p.id, p.amount into v_payment_id, v_payment_amount
    from payments p
    where p.school_id = v_school_id
      and p.method = 'mpesa'
      and p.reference is not null
      and upper(trim(p.reference)) = upper(v_receipt)
      and not exists (
        select 1 from mpesa_statement_lines msl
        where msl.matched_payment_id = p.id and msl.match_status in ('matched', 'amount_mismatch')
      )
    limit 1;

    if v_payment_id is null then
      v_status := 'not_in_system';
      v_not_in_system := v_not_in_system + 1;
    elsif round(v_payment_amount, 2) = round(v_amount, 2) then
      v_status := 'matched';
      v_matched := v_matched + 1;
    else
      v_status := 'amount_mismatch';
      v_mismatched := v_mismatched + 1;
    end if;

    insert into mpesa_statement_lines (batch_id, school_id, receipt_no, transaction_time, details, amount, match_status, matched_payment_id)
    values (v_batch_id, v_school_id, v_receipt, v_time, v_details, v_amount, v_status, v_payment_id);
  end loop;

  update mpesa_statement_batches
  set total_lines = v_total, matched_count = v_matched, mismatched_count = v_mismatched, not_in_system_count = v_not_in_system
  where id = v_batch_id;

  return query select v_batch_id, v_total, v_matched, v_mismatched, v_not_in_system;
end;
$$;

revoke execute on function public.import_mpesa_statement(jsonb, text) from public, anon;
grant execute on function public.import_mpesa_statement(jsonb, text) to authenticated;

comment on function public.import_mpesa_statement(jsonb, text) is 'Imports a pasted/uploaded M-Pesa Paybill statement (paid-in lines only) and matches each line against payments.reference for this school. Read-side reconciliation only -- never creates or modifies a payment.';
