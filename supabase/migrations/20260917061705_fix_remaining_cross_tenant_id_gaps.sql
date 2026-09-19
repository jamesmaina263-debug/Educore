-- Follow-up to 20260827054007_fix_cross_tenant_student_id_injection.sql.
-- That migration closed the "trusted foreign id parameter" hole for
-- create_fee_waiver, issue_library_loan, assign_transport, allocate_hostel_room
-- and allocate_bed. Three more functions with the identical shape were found
-- during a later audit and had not been patched:
--
--   1. generate_payroll_record(p_teacher_id, ...) never checked that
--      p_teacher_id belongs to the caller's school, and payroll_records_select's
--      self-access clause never checked the row's school_id against the
--      teacher's own school_id either -- so a payroll.write holder in one
--      school could generate a payslip (gross salary, PAYE, NSSF, SHIF, net
--      pay) naming a staff member in a different school, and that person
--      would see it via their own "my payslip" access.
--
--   2. issue_library_loan_to_staff(p_staff_id, ...) is the staff-loan sibling
--      of issue_library_loan(p_student_id, ...), which the earlier migration
--      fixed for students. The staff version (added after that fix) still
--      trusts p_staff_id outright, and library_loans_select's staff
--      self-access clause (staff_id = auth_school_user_id()) has no school_id
--      check -- unlike the guardian clause on the same policy, which the
--      earlier migration did add one to.
--
--   3. approve_requisition(p_supplier_id, ...) never checked that an
--      approver-supplied p_supplier_id override belongs to the caller's
--      school before using it on the resulting purchase order, and
--      _queue_supplier_po_email() only checks the PO's own school_id, not the
--      joined supplier's -- so an approver could point a PO (and the
--      automatic supplier email) at another school's vendor record.
--
-- Fix follows the exact same pattern as the earlier migration: validate the
-- referenced row belongs to the caller's school before it's used, and close
-- the matching read-side gap where one exists. Nothing else about these
-- functions or policies changes.

-- ---------------------------------------------------------------------
-- 1. generate_payroll_record: validate p_teacher_id, and require the
--    self-access RLS clause to also match the row's own school_id.
--
-- Checked directly against the live database before writing this: the
-- 8-param signature below is the one actually live and the one
-- generatePayrollAction() in src/app/(app)/payroll/actions.ts calls (it
-- always sends all 8 named params, so PostgREST always resolves to this
-- overload). But a stale 6-param overload (from before allowances_breakdown/
-- deductions_breakdown existed) is ALSO still live on the database --
-- apparently missed by 20260902041344_os08_drop_stale_function_overloads.sql,
-- which dropped the same kind of leftover overload for
-- issue_library_loan_to_staff and three others but not this one. Patching
-- only the 8-param version would leave that old, still-unvalidated overload
-- callable by anyone who omits the two newer named params -- a direct
-- bypass of the fix below -- so it's dropped here the same way that
-- migration dropped the other four.
drop function if exists public.generate_payroll_record(uuid, smallint, smallint, numeric, numeric, text);

create or replace function public.generate_payroll_record(
  p_teacher_id uuid,
  p_period_year smallint,
  p_period_month smallint,
  p_gross_salary numeric,
  p_other_deductions numeric default 0,
  p_other_deductions_note text default null,
  p_allowances_breakdown jsonb default null,
  p_deductions_breakdown jsonb default null
)
returns public.payroll_records
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_rate public.payroll_statutory_rates%rowtype;
  v_nssf numeric;
  v_shif numeric;
  v_ahl numeric;
  v_taxable numeric;
  v_paye_calc record;
  v_net numeric;
  v_generated_by uuid;
  v_period_date date := make_date(p_period_year, p_period_month, 1);
  v_result public.payroll_records;
begin
  if not auth_has_permission('payroll.write') then
    raise exception 'insufficient permissions: payroll.write required';
  end if;

  if not exists (
    select 1 from public.school_users where id = p_teacher_id and school_id = v_school_id
  ) then
    raise exception 'Staff member not found in your school.';
  end if;

  select su.id into v_generated_by from school_users su where su.auth_user_id = auth.uid();

  select * into v_rate
  from public.payroll_statutory_rates
  where effective_from <= v_period_date
  order by effective_from desc
  limit 1;

  if v_rate.id is null then
    raise exception 'no statutory rate configured for period %', v_period_date;
  end if;

  v_nssf := least(p_gross_salary, v_rate.nssf_lel) * v_rate.nssf_rate
          + greatest(least(p_gross_salary, v_rate.nssf_uel) - v_rate.nssf_lel, 0) * v_rate.nssf_rate;
  v_shif := greatest(p_gross_salary * v_rate.shif_rate, v_rate.shif_min);
  v_ahl := p_gross_salary * v_rate.ahl_rate;
  v_taxable := greatest(p_gross_salary - v_nssf - v_shif - v_ahl, 0);

  select * into v_paye_calc from public.compute_paye(v_taxable, v_rate.paye_bands, v_rate.personal_relief);

  v_net := p_gross_salary - v_nssf - v_shif - v_ahl - v_paye_calc.paye - p_other_deductions;

  insert into public.payroll_records (
    school_id, teacher_id, period_year, period_month, statutory_rate_id,
    gross_salary, nssf_employee, shif, ahl, taxable_income,
    paye_gross, personal_relief_applied, paye,
    other_deductions, other_deductions_note, allowances_breakdown, deductions_breakdown, net_pay,
    status, generated_by
  ) values (
    v_school_id, p_teacher_id, p_period_year, p_period_month, v_rate.id,
    p_gross_salary, v_nssf, v_shif, v_ahl, v_taxable,
    v_paye_calc.paye_gross, v_paye_calc.personal_relief, v_paye_calc.paye,
    p_other_deductions, p_other_deductions_note, p_allowances_breakdown, p_deductions_breakdown, v_net,
    'draft', v_generated_by
  )
  on conflict (school_id, teacher_id, period_year, period_month)
  do update set
    statutory_rate_id = excluded.statutory_rate_id,
    gross_salary = excluded.gross_salary,
    nssf_employee = excluded.nssf_employee,
    shif = excluded.shif,
    ahl = excluded.ahl,
    taxable_income = excluded.taxable_income,
    paye_gross = excluded.paye_gross,
    personal_relief_applied = excluded.personal_relief_applied,
    paye = excluded.paye,
    other_deductions = excluded.other_deductions,
    other_deductions_note = excluded.other_deductions_note,
    allowances_breakdown = excluded.allowances_breakdown,
    deductions_breakdown = excluded.deductions_breakdown,
    net_pay = excluded.net_pay,
    generated_by = excluded.generated_by,
    updated_at = now()
  where public.payroll_records.status = 'draft'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'payroll record for this staff member/period is already approved or paid — cannot regenerate';
  end if;

  return v_result;
end;
$$;

drop policy if exists payroll_records_select on public.payroll_records;
create policy payroll_records_select on public.payroll_records
  for select using (
    (school_id = auth_school_id() and auth_has_permission('payroll.read_any'))
    or exists (
      select 1 from school_users su
      where su.id = payroll_records.teacher_id
        and su.auth_user_id = auth.uid()
        and su.school_id = payroll_records.school_id
    )
  );

-- ---------------------------------------------------------------------
-- 2. issue_library_loan_to_staff: validate p_staff_id, matching the check
--    issue_library_loan already does for p_student_id. Tighten
--    library_loans_select's staff self-access clause to also require the
--    staff member's own school_id to match the row's school_id, matching
--    the guardian clause on the same policy.
-- ---------------------------------------------------------------------

create or replace function public.issue_library_loan_to_staff(
  p_item_id uuid, p_staff_id uuid, p_due_date date,
  p_client_mutation_id uuid default null
)
returns library_loans
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_issued_by uuid;
  v_available int;
  v_result public.library_loans;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  if not exists (select 1 from school_users where id = p_staff_id and school_id = v_school_id) then
    raise exception 'staff member not found in this school';
  end if;

  if p_client_mutation_id is not null then
    select * into v_result from library_loans
    where school_id = v_school_id and client_mutation_id = p_client_mutation_id;
    if found then
      return v_result;
    end if;
  end if;

  select su.id into v_issued_by from school_users su where su.auth_user_id = auth.uid();

  select available_copies into v_available from library_items where id = p_item_id and school_id = v_school_id for update;
  if v_available is null then
    raise exception 'library item not found in this school';
  end if;
  if v_available < 1 then
    raise exception 'no copies available for this item';
  end if;

  update library_items set available_copies = available_copies - 1, updated_at = now() where id = p_item_id;

  insert into library_loans (school_id, library_item_id, staff_id, issued_by, due_date, client_mutation_id)
  values (v_school_id, p_item_id, p_staff_id, v_issued_by, p_due_date, p_client_mutation_id)
  returning * into v_result;

  return v_result;
end;
$$;

-- Current definition (post initplan-perf tuning in
-- 20260903061901_fix_rls_auth_initplan_perf.sql) only swaps the staff
-- clause's bare `staff_id = auth_school_user_id()` for an explicit subquery
-- that also requires the staff member's own school_id to match this row's
-- school_id -- everything else is untouched, including the auth.uid()
-- caching pattern on the other clauses.
alter policy library_loans_select on public.library_loans
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('library.read_any'))
    or (auth_user_id_is_guardian_of(student_id) and (exists (select 1 from students st where st.id = library_loans.student_id and st.school_id = library_loans.school_id)))
    or (exists (select 1 from students st where st.id = library_loans.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active')))
    or (staff_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active' and su.school_id = library_loans.school_id))
  );

-- ---------------------------------------------------------------------
-- 3. approve_requisition: validate an approver-supplied p_supplier_id
--    override belongs to the caller's school before it can be used on the
--    resulting purchase order (and, downstream, in the automatic supplier
--    email). Nothing about cost resolution, the missing-supplier/missing-cost
--    checks, or the two-pass PO creation logic changes.
-- ---------------------------------------------------------------------

create or replace function public.approve_requisition(
  p_requisition_id uuid,
  p_supplier_id uuid default null,
  p_unit_cost_override numeric default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid := auth_school_user_id();
  v_req record;
  v_item record;
  v_resolved_supplier uuid;
  v_conflicting boolean := false;
  v_missing_supplier_items text := '';
  v_missing_cost_items text := '';
  v_po_id uuid;
  v_po public.purchase_orders;
  v_last record;
  v_item_cost numeric;
  v_item_supplier uuid;
begin
  if not auth_has_permission('inventory.procurement.approve') then
    raise exception 'insufficient permissions: inventory.procurement.approve required';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and school_id = v_school_id
  ) then
    raise exception 'Supplier not found in your school.';
  end if;

  select * into v_req
  from public.purchase_requisitions
  where id = p_requisition_id and school_id = v_school_id
  for update;

  if v_req.id is null then
    raise exception 'requisition not found in this school';
  end if;
  if v_req.status <> 'submitted' then
    raise exception 'requisition is not awaiting approval (status: %)', v_req.status;
  end if;

  -- Pass 1: resolve each item's supplier + cost, without writing anything yet.
  -- Collect what's missing so a single clear error can be raised if approval
  -- can't proceed, rather than failing on the first problem line only.
  for v_item in
    select * from public.purchase_requisition_items where requisition_id = p_requisition_id order by id
  loop
    v_item_supplier := null;
    -- Priority: the requisition's own estimate, then this item's own
    -- purchase history, and only then the approver's override -- the
    -- override must never steamroll a real historical price on a *different*
    -- line than the one it was meant to unblock.
    v_item_cost := v_item.estimated_unit_cost;

    if v_item.inventory_item_id is not null then
      select poi.quantity, poi.unit_cost, po.supplier_id
      into v_last
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      where poi.inventory_item_id = v_item.inventory_item_id
        and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;

      v_item_supplier := v_last.supplier_id;
      if v_item_cost is null then
        v_item_cost := v_last.unit_cost;
      end if;
    end if;

    if v_item_cost is null then
      v_item_cost := p_unit_cost_override;
    end if;

    -- An explicit p_supplier_id always overrides whatever history suggested
    -- (the approver picking one because auto-resolution failed or disagreed).
    if p_supplier_id is not null then
      v_item_supplier := p_supplier_id;
    end if;

    if v_item_supplier is null then
      v_missing_supplier_items := v_missing_supplier_items || case when v_missing_supplier_items = '' then '' else ', ' end || v_item.item_description;
    elsif v_resolved_supplier is null then
      v_resolved_supplier := v_item_supplier;
    elsif v_resolved_supplier <> v_item_supplier then
      v_conflicting := true;
    end if;

    if v_item_cost is null then
      v_missing_cost_items := v_missing_cost_items || case when v_missing_cost_items = '' then '' else ', ' end || v_item.item_description;
    end if;
  end loop;

  if v_missing_supplier_items <> '' or v_conflicting then
    raise exception 'Cannot auto-approve: no supplier on file for % -- select a supplier and try again.',
      case when v_missing_supplier_items <> '' then v_missing_supplier_items else 'these items (they resolve to different suppliers)' end;
  end if;
  if v_missing_cost_items <> '' then
    raise exception 'Cannot auto-approve: no unit cost on file for % -- provide a cost and try again.', v_missing_cost_items;
  end if;
  if v_resolved_supplier is null then
    raise exception 'Cannot auto-approve: requisition has no items.';
  end if;

  -- Pass 2: everything resolved -- create the PO + lines for real.
  insert into public.purchase_orders (school_id, requisition_id, supplier_id, status, created_by)
  values (v_school_id, p_requisition_id, v_resolved_supplier, 'sent', v_actor)
  returning id into v_po_id;

  for v_item in
    select * from public.purchase_requisition_items where requisition_id = p_requisition_id order by id
  loop
    v_item_cost := v_item.estimated_unit_cost;
    if v_item.inventory_item_id is not null and v_item_cost is null then
      select unit_cost into v_item_cost
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      where poi.inventory_item_id = v_item.inventory_item_id and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;
    end if;
    if v_item_cost is null then
      v_item_cost := p_unit_cost_override;
    end if;

    insert into public.purchase_order_items (po_id, school_id, item_description, quantity, unit_cost, inventory_item_id)
    values (v_po_id, v_school_id, v_item.item_description, v_item.quantity, v_item_cost, v_item.inventory_item_id);
  end loop;

  update public.purchase_requisitions
  set status = 'converted',
      approved_by = v_actor,
      approved_at = now(),
      updated_at = now()
  where id = p_requisition_id;

  perform public._queue_supplier_po_email(v_po_id, v_school_id);

  if v_req.requested_by is not null then
    perform public.notify_school_user(
      p_recipient_id => v_req.requested_by,
      p_subject => 'Requisition approved',
      p_body => 'Your requisition for "' || v_req.purpose || '" was approved and a purchase order has been raised automatically.',
      p_action_url => case
        when public.school_user_has_permission(v_req.requested_by, 'inventory.read_any') then '/inventory/procurement'
        else '/health/inventory'
      end,
      p_category => 'other'
    );
  end if;

  select * into v_po from public.purchase_orders where id = v_po_id;
  return v_po;
end;
$$;
