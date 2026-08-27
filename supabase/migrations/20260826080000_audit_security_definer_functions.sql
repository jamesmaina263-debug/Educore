-- Audit of every SECURITY DEFINER function in the schema (132 non-trigger functions),
-- checking (1) whether each has a real in-body authorization check, and (2) which are
-- actually reachable by `anon`/`authenticated` via their EXECUTE grants -- the grant is
-- the real gate; a missing in-body check only matters if the grant allows a client to
-- reach it at all.

-- 1) CRITICAL: reconcile_pending_mpesa_payments(p_student_id, p_school_id) had no
-- in-body authorization check at all, and a live grant audit found it executable by
-- BOTH `anon` (unauthenticated!) and `authenticated` -- despite the migration that
-- originally created it explicitly revoking from anon. A later `create or replace
-- function` apparently reset the ACL back toward the Postgres default (EXECUTE granted
-- to PUBLIC), silently reopening it. Since this function allocates unallocated
-- payments, marks them confirmed, and generates receipts for an arbitrary (student_id,
-- school_id) pair with zero ownership check, this let anyone on the internet trigger
-- financial writes against any school's students.
--
-- Fixed two ways for defense in depth, since relying on GRANT/REVOKE alone already
-- silently regressed once: an in-body check (service-role calls pass through
-- unchanged; an authenticated caller must be acting on their own school or be a super
-- admin), plus re-issuing the REVOKE from public/anon. Also added the same
-- pg_advisory_xact_lock(hashtext('student_payments:' || ...)) pattern record_payment()
-- already uses, since this function had no lock at all -- two concurrent calls could
-- double-allocate the same unallocated payment.

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

-- 2) HIGH: generate_receipt(p_payment_id) had no in-body auth check and was directly
-- executable by `authenticated`, taking an arbitrary payment_id with no ownership
-- verification -- an IDOR letting any authenticated user read or create a receipt for
-- another school's payment. No app code calls it via RPC at all; it's purely an
-- internal helper invoked from record_payment() and reconcile_pending_mpesa_payments()
-- (both SECURITY DEFINER, executing as the function owner, so this doesn't affect those
-- internal calls). Matches the grant pattern already used for other internal-only
-- helpers like ensure_student_financial_account_for_webhook.

revoke all on function public.generate_receipt(uuid) from public, anon, authenticated;
grant execute on function public.generate_receipt(uuid) to service_role;

-- 3) LOW: log_medical_record_access(p_student_id) had no school-scoping check: a
-- caller could pass a student_id belonging to a different school, producing a minor
-- existence-oracle leak and an audit_log entry mixing the caller's own school_id with
-- another school's student/resource. Currently unused by any app code, but scoping it
-- properly costs nothing.

create or replace function public.log_medical_record_access(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_school_user_id uuid;
  v_caller_school_id uuid;
  v_medical_record_id uuid;
begin
  select id, school_id into v_caller_school_user_id, v_caller_school_id
  from school_users where auth_user_id = auth.uid() and status = 'active';

  if v_caller_school_id is null then
    return;
  end if;

  select id into v_medical_record_id
  from medical_records
  where student_id = p_student_id and school_id = v_caller_school_id;

  if v_medical_record_id is null then
    return;
  end if;

  insert into document_access_log (school_id, accessed_by, resource_type, resource_id, student_id)
  values (v_caller_school_id, v_caller_school_user_id, 'medical_record', v_medical_record_id, p_student_id);
end;
$function$;

-- 4) DEFENSE IN DEPTH: 25 other SECURITY DEFINER functions (student/guardian deletion,
-- payroll generation, inventory writes, admission edits, biometric gate config, etc.)
-- were executable by `anon` -- almost certainly Postgres's default EXECUTE-to-PUBLIC
-- grant on function creation, never a deliberate choice, since none of these should
-- ever legitimately run pre-authentication. Individually verified every one already has
-- an unconditional auth_has_permission(...) or (auth_is_super_admin() OR auth.role() =
-- 'service_role') check as its first statement and is therefore not currently
-- exploitable via the loose grant -- but removing anon's access closes the exact class
-- of bug that DID make reconcile_pending_mpesa_payments exploitable (a body that
-- trusted an ambiguous signal as a proxy for "trusted caller" combined with a leftover
-- anon grant), pre-emptively, for these and anything written this way in future.

revoke execute on function public.accept_inventory_transfer(uuid, integer) from anon;
revoke execute on function public.approve_health_stock_adjustment(uuid) from anon;
revoke execute on function public.archive_old_communications() from anon;
revoke execute on function public.create_health_inventory_item(text, text, integer, date, uuid) from anon;
revoke execute on function public.create_inventory_item(text, text, integer, text, integer, text, uuid) from anon;
revoke execute on function public.create_inventory_transfer(uuid, integer) from anon;
revoke execute on function public.delete_communication_permanently(text, uuid, text) from anon;
revoke execute on function public.delete_school_user_permanently(uuid, text) from anon;
revoke execute on function public.delete_student_permanently(uuid, text) from anon;
revoke execute on function public.generate_payroll_record(uuid, smallint, smallint, numeric, numeric, text) from anon;
revoke execute on function public.generate_payroll_record(uuid, smallint, smallint, numeric, numeric, text, jsonb, jsonb) from anon;
revoke execute on function public.get_staff_statutory_numbers(uuid[]) from anon;
revoke execute on function public.group_schools_summary(uuid) from anon;
revoke execute on function public.issue_health_stock(uuid, integer, text) from anon;
revoke execute on function public.merge_guardian_accounts(uuid, uuid, text) from anon;
revoke execute on function public.next_admission_number() from anon;
revoke execute on function public.purge_expired_communications() from anon;
revoke execute on function public.queue_health_alert(uuid, uuid[], text) from anon;
revoke execute on function public.recompute_student_risk_scores(uuid) from anon;
revoke execute on function public.record_goods_received(uuid, uuid, integer) from anon;
revoke execute on function public.reject_health_stock_adjustment(uuid, text) from anon;
revoke execute on function public.reject_inventory_transfer(uuid, text) from anon;
revoke execute on function public.request_health_stock_adjustment(uuid, integer, text) from anon;
revoke execute on function public.send_fee_threshold_alert(uuid) from anon;
revoke execute on function public.update_admission_identity(uuid, text, text, text, date, text) from anon;
revoke execute on function public.update_gate_late_thresholds(time, time) from anon;
revoke execute on function public.update_staff_statutory_numbers(uuid, text, text, text, text) from anon;
