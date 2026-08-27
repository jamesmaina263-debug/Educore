
create or replace function approve_discount(p_discount_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_invoice_id uuid;
  v_approver uuid;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to approve discounts.';
  end if;
  select invoice_id into v_invoice_id from discounts where id = p_discount_id and school_id = v_school_id and status = 'pending';
  if v_invoice_id is null then
    raise exception 'Discount not found or not pending.';
  end if;

  select id into v_approver from school_users where auth_user_id = auth.uid();
  update discounts set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_discount_id;

  perform recompute_invoice_status(v_invoice_id);

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'discounts', p_discount_id, 'approve', jsonb_build_object('status', 'approved'));
end;
$$;

create or replace function reject_discount(p_discount_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to reject discounts.';
  end if;
  if not exists (select 1 from discounts where id = p_discount_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Discount not found or not pending.';
  end if;

  select id into v_approver from school_users where auth_user_id = auth.uid();
  update discounts set status = 'rejected', approved_by = v_approver, approved_at = now() where id = p_discount_id;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'discounts', p_discount_id, 'reject', jsonb_build_object('status', 'rejected'));
end;
$$;

create or replace function approve_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('expenses.approve') then
    raise exception 'Not authorized to approve expenses.';
  end if;
  if not exists (select 1 from expenses where id = p_expense_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Expense not found or not pending.';
  end if;
  select id into v_approver from school_users where auth_user_id = auth.uid();
  update expenses set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_expense_id;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'expenses', p_expense_id, 'approve', jsonb_build_object('status', 'approved'));
end;
$$;

create or replace function reject_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('expenses.approve') then
    raise exception 'Not authorized to reject expenses.';
  end if;
  if not exists (select 1 from expenses where id = p_expense_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Expense not found or not pending.';
  end if;
  select id into v_approver from school_users where auth_user_id = auth.uid();
  update expenses set status = 'rejected', approved_by = v_approver, approved_at = now() where id = p_expense_id;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'expenses', p_expense_id, 'reject', jsonb_build_object('status', 'rejected'));
end;
$$;

create or replace function revoke_fee_waiver(p_waiver_id uuid)
returns void
language plpgsql security definer set search_path = 'public' as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to revoke a fee waiver.';
  end if;

  select id into v_actor from school_users where auth_user_id = auth.uid();

  update fee_waivers set status = 'revoked', updated_at = now()
    where id = p_waiver_id and school_id = v_school_id;
  if not found then raise exception 'Fee waiver not found.'; end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_actor, 'fee_waivers', p_waiver_id, 'revoke', jsonb_build_object('status', 'revoked'));
end;
$$;
