-- Bug: get_or_create_student_financial_account() hardcoded 'EDU' (the platform's own name)
-- as the prefix for every school's student payment/account reference, drawing from one
-- single global sequence (student_payment_reference_seq). Result: two different schools'
-- account codes are indistinguishable from each other ("EDU00034" tells you nothing about
-- which school it belongs to), and a school's own reference numbers are scattered/non-
-- sequential because they're interleaved with every other school's account creations.
--
-- Fix: use the school's own application_number_prefix (already established for application_
-- number and po_number) and a per-school sequence, matching the {PREFIX}{SEQ} short/static
-- format appropriate for a reference a parent re-types into M-Pesa on every payment (no
-- slashes/dates -- unlike application/PO/invoice/receipt numbers, this one is never tied to
-- a single event, so a date component would be misleading).
--
-- Historical accounts keep their existing EDU-prefixed reference -- these may already be in
-- active use as real M-Pesa paybill account numbers, so renaming them now would risk
-- misdirected/unreconciled parent payments. This only changes references generated from here
-- forward, same convention as every previous school-prefix migration in this repo.
create or replace function public.get_or_create_student_financial_account(p_student_id uuid)
returns student_financial_accounts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_account student_financial_accounts;
  v_prefix text;
  v_next int;
  v_reference text;
begin
  select id into v_account.id from student_financial_accounts where student_id = p_student_id;
  if v_account.id is not null then
    select * into v_account from student_financial_accounts where student_id = p_student_id;
    return v_account;
  end if;

  if not (auth_has_permission('finance.write') or auth_has_permission('students.write')) then
    raise exception 'Not authorized to create a Student Financial Account.';
  end if;

  select school_id into v_school_id from students where id = p_student_id;
  if v_school_id is null then
    raise exception 'Student not found.';
  end if;

  select application_number_prefix into v_prefix from public.schools where id = v_school_id;
  if v_prefix is null then
    raise exception 'School has no application number prefix configured.';
  end if;

  -- Own advisory-lock namespace, per school, separate from application_number's/po_number's/
  -- invoice_number's/receipt_number's -- these series never contend for the same lock despite
  -- sharing a school prefix.
  perform pg_advisory_xact_lock(hashtext(v_school_id::text || '-payref'));

  select coalesce(max(substring(payment_reference from '(\d+)$')::int), 0) + 1
    into v_next
    from public.student_financial_accounts
    where school_id = v_school_id
      and payment_reference like v_prefix || '%';

  v_reference := v_prefix || lpad(v_next::text, 5, '0');

  insert into student_financial_accounts (school_id, student_id, payment_reference)
  values (v_school_id, p_student_id, v_reference)
  returning * into v_account;

  return v_account;
end;
$function$;
