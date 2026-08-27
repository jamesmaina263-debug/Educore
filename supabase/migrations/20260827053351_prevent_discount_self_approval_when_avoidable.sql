-- Security finding (finance module review): approve_discount() only checked
-- `discounts.approve` on the caller -- it never checked whether the caller
-- was also the person who *requested* the discount (discounts.requested_by).
--
-- request_discount() requires finance.write; approve_discount() requires
-- discounts.approve. Those are meant to be a segregation-of-duties control --
-- see finance_discounts.sql's own comment: "a bursar cannot unilaterally
-- discount a fee" -- but 'school_owner' (and often 'principal') holds BOTH
-- permissions by default (finance_fee_structures.sql grants finance.write to
-- 'bursar'/'school_owner'; finance_discounts.sql grants discounts.approve to
-- 'principal'/'school_owner'). Nothing stopped that same person from calling
-- request_discount() then immediately approve_discount() on their own
-- request -- i.e. unilaterally discounting a fee, exactly what the control
-- was meant to prevent.
--
-- Not fixed as a blanket "approver != requester" block: every new school
-- starts as a single school_owner account (see signup/actions.ts), and that
-- owner is the only person who can hold discounts.approve until more staff
-- are added. A hard block would leave every new school unable to approve any
-- discount at all -- breaking working functionality for the common case,
-- which the audit brief explicitly rules out.
--
-- Fix: block self-approval only when someone *else* in the school could
-- actually approve it instead (checked via school_user_has_permission(),
-- 20260825045022, which resolves the same user/school-override/default
-- precedence as auth_has_permission() but for an arbitrary target). If no
-- other eligible approver exists, self-approval is still allowed (preserves
-- solo-operator schools) but is flagged in the audit log so it's visible to
-- anyone reviewing finance activity, rather than being indistinguishable
-- from a normal two-person approval.
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
