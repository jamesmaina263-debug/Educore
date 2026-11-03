-- WP 4.2: two-person rule for expenses and payroll approval, copying the discount pattern
-- (20260827053351_prevent_discount_self_approval_when_avoidable.sql): the person who raised something may not
-- approve it themselves WHEN SOMEONE ELSE in the school could approve it instead. A school with a single
-- approver (the usual new school) keeps working; that self-approval is flagged in the audit log.
--
-- Switch: platform flag `feature.controls.two_person`, off for everyone (per school, default off). With the flag
-- off every function below behaves exactly as before. The user approved editing these existing functions
-- (3 Nov 2026): approve_expense, raise_expense, approve_payroll_record. Signatures, return types, security mode,
-- search_path and grants are unchanged (CREATE OR REPLACE keeps the grants).
-- NOT in this WP: payment reversals and refunds (payment flows; the user said to skip payments; refunds are 4.3).

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.controls.two_person',
       'Two-person approval rule',
       'Expenses and payroll cannot be approved by the person who raised them when another approver exists. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.controls.two_person');

-- 2. Helper: is there another active user in the school who holds the permission? Internal only.
create or replace function public.two_person_other_approver_exists(p_school_id uuid, p_exclude uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.school_users su
     where su.school_id = p_school_id
       and su.status = 'active'
       and su.id is distinct from p_exclude
       and public.school_user_has_permission(su.id, p_permission)
  );
$function$;
revoke all on function public.two_person_other_approver_exists(uuid, uuid, text) from public, anon, authenticated;

-- 3. approve_expense: with the flag on, the requester cannot approve their own expense if another approver exists.
create or replace function public.approve_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
  v_requested_by uuid;
  v_two_person boolean := false;
begin
  if not auth_has_permission('expenses.approve') then
    raise exception 'Not authorized to approve expenses.';
  end if;
  select requested_by into v_requested_by from expenses where id = p_expense_id and school_id = v_school_id and status = 'pending';
  if not found then
    raise exception 'Expense not found or not pending.';
  end if;
  select id into v_approver from school_users where auth_user_id = auth.uid();

  v_two_person := public.school_has_feature_flag(v_school_id, 'feature.controls.two_person');
  if v_two_person and v_requested_by is not null and v_requested_by = v_approver
     and public.two_person_other_approver_exists(v_school_id, v_approver, 'expenses.approve') then
    raise exception 'You raised this expense, so someone else with approval rights needs to approve it.';
  end if;

  update expenses set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_expense_id;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'expenses', p_expense_id, 'approve',
          case when v_two_person then jsonb_build_object('status', 'approved', 'self_approved', v_requested_by is not distinct from v_approver)
               else jsonb_build_object('status', 'approved') end);
end;
$function$;

-- 4. raise_expense: with the flag on, an approver's own expense is NOT auto-approved when another approver exists
--    (it stays pending for the other person). The configured amount threshold still auto-approves small expenses,
--    because the school chose that explicitly.
create or replace function public.raise_expense(p_category text, p_vendor text, p_amount numeric, p_description text default null::text, p_receipt_url text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_requester uuid;
  v_threshold numeric;
  v_status text := 'pending';
  v_expense_id uuid;
  v_is_approver boolean;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to raise expenses.';
  end if;

  select id into v_requester from school_users where auth_user_id = auth.uid();
  select expense_approval_threshold into v_threshold from schools where id = v_school_id;

  v_is_approver := auth_has_permission('expenses.approve');
  if v_is_approver
     and public.school_has_feature_flag(v_school_id, 'feature.controls.two_person')
     and public.two_person_other_approver_exists(v_school_id, v_requester, 'expenses.approve') then
    v_is_approver := false;  -- another approver exists: this one waits for them
  end if;

  if v_is_approver or (v_threshold is not null and p_amount <= v_threshold) then
    v_status := 'approved';
  end if;

  insert into expenses (school_id, category, vendor, amount, description, receipt_url, status, requested_by, approved_by, approved_at)
  values (v_school_id, p_category, p_vendor, p_amount, p_description, p_receipt_url, v_status, v_requester,
    case when v_status = 'approved' then v_requester else null end,
    case when v_status = 'approved' then now() else null end)
  returning id into v_expense_id;

  return v_expense_id;
end;
$function$;

-- 5. approve_payroll_record: with the flag on, whoever generated the record cannot approve it if another
--    payroll approver exists.
create or replace function public.approve_payroll_record(p_id uuid)
returns payroll_records
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_approver uuid;
  v_generated_by uuid;
  v_school uuid := auth_school_id();
  v_result public.payroll_records;
begin
  if not auth_has_permission('payroll.approve') then
    raise exception 'insufficient permissions: payroll.approve required';
  end if;

  select su.id into v_approver from school_users su where su.auth_user_id = auth.uid();

  select pr.generated_by into v_generated_by from public.payroll_records pr
   where pr.id = p_id and pr.school_id = v_school and pr.status = 'draft';
  if found and v_generated_by is not null and v_generated_by = v_approver
     and public.school_has_feature_flag(v_school, 'feature.controls.two_person')
     and public.two_person_other_approver_exists(v_school, v_approver, 'payroll.approve') then
    raise exception 'You generated this payroll record, so someone else with approval rights needs to approve it.';
  end if;

  update public.payroll_records
  set status = 'approved', approved_by = v_approver, approved_at = now(), updated_at = now()
  where id = p_id and school_id = v_school and status = 'draft'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'payroll record not found, not in this school, or not in draft status';
  end if;

  return v_result;
end;
$function$;
