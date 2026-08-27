-- CRITICAL: reconcile_pending_mpesa_payments(p_student_id, p_school_id) has no in-body
-- authorization check at all, and a live grant audit found it currently executable by
-- BOTH `anon` (unauthenticated!) and `authenticated` -- despite the migration that
-- originally created it explicitly revoking from anon. A later `create or replace
-- function` (20260825091947_fix_admission_payment_never_dropped.sql) apparently reset
-- the ACL back toward the Postgres default (EXECUTE granted to PUBLIC), silently
-- reopening it. Since this function operates on real payment/invoice rows -- allocating
-- unallocated payments, marking them confirmed, generating receipts -- for an arbitrary
-- (student_id, school_id) pair with zero ownership check, this let anyone on the internet
-- trigger financial writes against any school's students.
--
-- Fixing this two ways for defense in depth, since relying on GRANT/REVOKE alone already
-- silently regressed once:
-- 1. In-body check: service-role calls (auth.uid() is null, e.g. the M-Pesa webhook) pass
--    through unchanged; an authenticated caller must be acting on their own school (or be
--    a super admin).
-- 2. Re-issue the REVOKE from public/anon and GRANT to authenticated/service_role that the
--    original migration intended.
--
-- Also added the same pg_advisory_xact_lock(hashtext('student_payments:' || ...)) pattern
-- record_payment() already uses, since this function had no lock at all -- two concurrent
-- calls (now confirmed reachable pre-auth) could double-allocate the same unallocated
-- payment before either transaction committed its status update.

create or replace function public.reconcile_pending_mpesa_payments(p_student_id uuid, p_school_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_remaining numeric;
  v_invoice record;
  v_apply numeric;
begin
  if auth.uid() is not null then
    if not auth_is_super_admin() and p_school_id is distinct from auth_school_id() then
      raise exception 'insufficient privileges to reconcile payments for another school';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('student_payments:' || p_student_id::text));

  -- Broadened from "M-Pesa API payments only" to any unallocated payment already tied to
  -- this student (manual cash/bank/cheque entries included) -- see BUG B, prior migration.
  for v_payment in
    select id, amount from public.payments
    where student_id = p_student_id
      and school_id = p_school_id
      and status = 'unallocated'
    order by recorded_at asc
  loop
    v_remaining := v_payment.amount;

    for v_invoice in
      select id, total_amount,
        total_amount - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
      from public.invoices
      where student_id = p_student_id and school_id = p_school_id and status != 'paid'
      order by created_at asc
    loop
      exit when v_remaining <= 0;
      if v_invoice.outstanding <= 0 then continue; end if;
      v_apply := least(v_remaining, v_invoice.outstanding);
      insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
        values (v_payment.id, v_invoice.id, v_apply, 'allocation');
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_remaining < v_payment.amount then
      update public.payments set status = 'confirmed' where id = v_payment.id;
      perform public.generate_receipt(v_payment.id);
      insert into public.audit_log (school_id, table_name, record_id, action, new_data)
        values (p_school_id, 'payments', v_payment.id, 'auto_allocate',
          jsonb_build_object('student_id', p_student_id, 'trigger', 'invoice_available', 'amount', v_payment.amount));
    end if;
  end loop;
end;
$function$;

revoke all on function public.reconcile_pending_mpesa_payments(uuid, uuid) from public, anon;
grant execute on function public.reconcile_pending_mpesa_payments(uuid, uuid) to authenticated, service_role;
