-- Same bug as get_or_create_student_financial_account (fixed separately): generate_receipt()
-- built receipt_number from a fixed 'RCT-' tag off one global sequence (receipt_number_seq),
-- with no school prefix at all -- receipts.receipt_number is already uniquely constrained
-- per (school_id, receipt_number), so the schema itself already intended per-school
-- numbering; the generator just never matched that.
--
-- Fix: same {SCHOOL-PREFIX}-{TAG}/{YY}/{DD}/{MM}/{SEQ} shape already used for application_
-- number and po_number, just with an -RCT tag, so every date-stamped document reference
-- in the app now looks and sorts the same way, only the tag changes.
--
-- Historical receipts keep their existing RCT-YYYY-NNNNNN numbers -- these are parent-facing
-- payment receipts that may already be printed/reconciled, so renaming them now would be
-- actively harmful. Only receipts generated from here forward get the new format.
create or replace function public.generate_receipt(p_payment_id uuid)
returns receipts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_receipt receipts;
  v_school_id uuid;
  v_student_id uuid;
  v_prefix text;
  v_year2 text := to_char(now(), 'YY');
  v_day text := to_char(now(), 'DD');
  v_month text := to_char(now(), 'MM');
  v_next int;
  v_number text;
begin
  select * into v_receipt from receipts where payment_id = p_payment_id;
  if v_receipt.id is not null then
    return v_receipt;
  end if;

  select school_id, student_id into v_school_id, v_student_id from payments where id = p_payment_id;
  if v_student_id is null then
    return null;
  end if;

  select application_number_prefix into v_prefix from public.schools where id = v_school_id;
  if v_prefix is null then
    raise exception 'School has no application number prefix configured.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_school_id::text || v_year2 || '-rct'));

  select coalesce(max(substring(receipt_number from '(\d+)$')::int), 0) + 1
    into v_next
    from public.receipts
    where school_id = v_school_id
      and receipt_number like v_prefix || '-RCT/' || v_year2 || '/%';

  v_number := v_prefix || '-RCT/' || v_year2 || '/' || v_day || '/' || v_month || '/' || lpad(v_next::text, 3, '0');

  insert into receipts (school_id, payment_id, student_id, receipt_number)
  values (v_school_id, p_payment_id, v_student_id, v_number)
  returning * into v_receipt;

  return v_receipt;
end;
$function$;
