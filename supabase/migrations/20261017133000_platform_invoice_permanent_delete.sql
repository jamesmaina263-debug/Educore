-- Permanent deletion of a platform (subscription) invoice, for the platform admin console.
--
-- Why this exists: invoices were deliberately undeletable (a guard trigger rejected every DELETE
-- and the history table is append-only) so that real billing records could only be cancelled. That
-- is the right default, but it left no way to remove a TRIAL invoice that a platform admin
-- created by mistake and that the school can see. This adds ONE narrow, audited escape hatch.
--
-- How it stays safe:
--   * Only delete_platform_invoice_permanently() can delete. It requires a platform super admin
--     (not service_role), a reason, and the invoice number typed back exactly.
--   * The two guard triggers still reject every other DELETE/UPDATE. They now accept a DELETE only
--     while a transaction-local flag (educore.invoice_hard_delete) is on; the function sets it
--     immediately before the delete and clears it immediately after, so it never outlives the call.
--   * The function returns a full snapshot of what was removed; the server action writes it to
--     platform_admin_activity_log, which is what remains of the invoice afterwards.
--   * Direct SQL / any other code path is unchanged: invoices still cannot be deleted.

-- ============================================================
-- 1. Guards: allow DELETE only inside the sanctioned function
-- ============================================================
create or replace function public.platform_invoices_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('educore.invoice_hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Invoices cannot be deleted. Cancel the invoice instead.' using errcode = '42501';
  end if;
  if coalesce(current_setting('educore.invoice_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Invoices must be created through the invoicing functions.' using errcode = '42501';
  end if;
  if (new.school_id, new.invoice_number, new.period_start, new.period_end, new.student_count,
      new.unit_price_kes, new.subtotal_kes, new.discount_kes, new.tax_kes, new.amount_kes,
      new.amount_paid_kes, new.invoice_date, new.status, new.due_at, new.paid_at, new.cancelled_at, new.source)
     is distinct from
     (old.school_id, old.invoice_number, old.period_start, old.period_end, old.student_count,
      old.unit_price_kes, old.subtotal_kes, old.discount_kes, old.tax_kes, old.amount_kes,
      old.amount_paid_kes, old.invoice_date, old.status, old.due_at, old.paid_at, old.cancelled_at, old.source) then
    raise exception 'Financial fields on an invoice can only be changed through the invoicing functions.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- UPDATE stays forbidden unconditionally; only DELETE can be unlocked, and only by the flag.
create or replace function public.platform_invoice_events_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('educore.invoice_hard_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'platform_invoice_events is append-only.' using errcode = '42501';
end;
$$;

revoke all on function public.platform_invoices_guard() from public, anon, authenticated;
revoke all on function public.platform_invoice_events_append_only() from public, anon, authenticated;

-- ============================================================
-- 2. The one sanctioned way to delete
-- ============================================================
create or replace function public.delete_platform_invoice_permanently(
  p_invoice_id uuid,
  p_confirm_number text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_school_name text;
  v_payments integer;
  v_events integer;
  v_m text[];
  v_year integer;
  v_seq integer;
  v_last integer;
  v_max integer;
  v_rolled boolean := false;
begin
  -- Platform super admin only. Deliberately NOT open to service_role: this is a human decision.
  if not auth_is_super_admin() then
    raise exception 'Not authorized to permanently delete an invoice.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required to permanently delete an invoice.';
  end if;

  select * into v_inv from public.platform_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;

  -- Serialise with invoice creation for the same school, then lock the row.
  perform pg_advisory_xact_lock(hashtextextended('platform_invoice:' || v_inv.school_id::text, 0));
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;

  if p_confirm_number is null or btrim(p_confirm_number) <> v_inv.invoice_number then
    raise exception 'The invoice number you typed does not match %. Nothing was deleted.', v_inv.invoice_number;
  end if;

  select name into v_school_name from public.schools where id = v_inv.school_id;
  select count(*) into v_payments from public.platform_invoice_payments where invoice_id = p_invoice_id;
  select count(*) into v_events from public.platform_invoice_events where invoice_id = p_invoice_id;

  perform set_config('educore.invoice_hard_delete', 'on', true);
  -- A reissued invoice points at the one it replaced; detach so the FK does not block the delete.
  update public.platform_invoices set replaces_invoice_id = null where replaces_invoice_id = p_invoice_id;
  delete from public.platform_invoice_payments where invoice_id = p_invoice_id;
  delete from public.platform_invoice_events where invoice_id = p_invoice_id;
  delete from public.platform_invoices where id = p_invoice_id;
  perform set_config('educore.invoice_hard_delete', 'off', true);

  -- Give the number back ONLY when this was the newest number of its year and the invoice was never
  -- emailed/marked sent, so a deleted trial invoice does not leave a gap. Anything that may already be
  -- in the school's hands keeps its number retired (a visible gap beats a reused number).
  v_m := regexp_match(v_inv.invoice_number, '-([0-9]{4})-([0-9]+)$');
  if v_m is not null and v_inv.sent_at is null then
    v_year := v_m[1]::integer;
    v_seq := v_m[2]::integer;
    select last_value into v_last from public.platform_invoice_counters where year = v_year for update;
    if found and v_last = v_seq then
      select coalesce(max((regexp_match(i.invoice_number, '-([0-9]{4})-([0-9]+)$'))[2]::integer), 0)
        into v_max
        from public.platform_invoices i
        where (regexp_match(i.invoice_number, '-([0-9]{4})-([0-9]+)$'))[1]::integer = v_year;
      update public.platform_invoice_counters set last_value = v_max where year = v_year;
      v_rolled := true;
    end if;
  end if;

  -- If this was the school's only overdue invoice, lift the overdue suspension, exactly as paying it would.
  perform public._platform_reactivate_if_clear(v_inv.school_id);

  return jsonb_build_object(
    'invoice_number', v_inv.invoice_number,
    'school_id', v_inv.school_id,
    'school_name', v_school_name,
    'status', v_inv.status,
    'amount_kes', v_inv.amount_kes,
    'amount_paid_kes', v_inv.amount_paid_kes,
    'period_start', v_inv.period_start,
    'period_end', v_inv.period_end,
    'source', v_inv.source,
    'was_sent', v_inv.sent_at is not null,
    'payments_deleted', v_payments,
    'history_rows_deleted', v_events,
    'number_reusable', v_rolled,
    'reason', btrim(p_reason)
  );
end;
$$;

revoke all on function public.delete_platform_invoice_permanently(uuid, text, text) from public, anon;
grant execute on function public.delete_platform_invoice_permanently(uuid, text, text) to authenticated;

comment on function public.delete_platform_invoice_permanently(uuid, text, text) is
  'Platform super admin only. Hard-deletes one subscription invoice with its payments and history after the invoice number is typed back and a reason given. The only code path that can delete invoices; returns a snapshot for the admin activity log.';
