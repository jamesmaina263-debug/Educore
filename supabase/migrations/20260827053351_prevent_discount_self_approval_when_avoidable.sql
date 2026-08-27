create or replace function approve_discount(p_discount_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_invoice_id uuid;
  v_requested_by uuid;
  v_approver uuid;
  v_other_approver_exists boolean;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to approve discounts.';
  end if;

  select invoice_id, requested_by into v_invoice_id, v_requested_by
    from discounts where id = p_discount_id and school_id = v_school_id and status = 'pending';
  if v_invoice_id is null then
    raise exception 'Discount not found or not pending.';
  end if;

  select id into v_approver from school_users where auth_user_id = auth.uid();

  if v_requested_by is not null and v_requested_by = v_approver then
    select exists (
      select 1
      from school_users su
      where su.school_id = v_school_id
        and su.status = 'active'
        and su.id <> v_approver
        and school_user_has_permission(su.id, 'discounts.approve')
    ) into v_other_approver_exists;

    if v_other_approver_exists then
      raise exception 'You requested this discount, so someone else with approval rights needs to approve it.';
    end if;
  end if;

  update discounts set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_discount_id;

  perform recompute_invoice_status(v_invoice_id);

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_approver, 'discounts', p_discount_id, 'approve',
    jsonb_build_object('status', 'approved', 'self_approved', v_requested_by = v_approver));
end;
$$;
