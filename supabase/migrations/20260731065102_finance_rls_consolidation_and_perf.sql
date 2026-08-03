
-- Consolidates the three-population SELECT access (staff / guardian / self) into one policy per
-- table instead of three separate permissive policies (functionally identical — Postgres ORs
-- permissive policies together either way — but the advisor flags the redundant per-row evaluation).
-- Also wraps auth.uid() in (select auth.uid()) so Postgres can treat it as a stable initplan
-- instead of re-evaluating it per row (the other auth_* helper functions already do this internally;
-- these were the first policies in the project to call auth.uid() directly rather than through one
-- of those helpers).

drop policy invoices_select_staff on invoices;
drop policy invoices_select_guardian on invoices;
drop policy invoices_select_self on invoices;
create policy invoices_select on invoices for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(invoices.student_id)
    or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = invoices.student_id and su.auth_user_id = (select auth.uid()))
  );

drop policy invoice_items_select_staff on invoice_items;
drop policy invoice_items_select_guardian on invoice_items;
drop policy invoice_items_select_self on invoice_items;
create policy invoice_items_select on invoice_items for select
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_items.invoice_id
        and (
          (i.school_id = auth_school_id() and auth_has_permission('finance.read'))
          or auth_user_id_is_guardian_of(i.student_id)
          or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = i.student_id and su.auth_user_id = (select auth.uid()))
        )
    )
  );

drop policy payments_select_staff on payments;
drop policy payments_select_guardian on payments;
drop policy payments_select_self on payments;
create policy payments_select on payments for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(payments.student_id)
    or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = payments.student_id and su.auth_user_id = (select auth.uid()))
  );

drop policy payment_allocations_select_staff on payment_allocations;
drop policy payment_allocations_select_guardian on payment_allocations;
drop policy payment_allocations_select_self on payment_allocations;
create policy payment_allocations_select on payment_allocations for select
  using (
    exists (
      select 1 from payments p
      where p.id = payment_allocations.payment_id
        and (
          (p.school_id = auth_school_id() and auth_has_permission('finance.read'))
          or auth_user_id_is_guardian_of(p.student_id)
          or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = p.student_id and su.auth_user_id = (select auth.uid()))
        )
    )
  );

drop policy discounts_select_staff on discounts;
drop policy discounts_select_guardian on discounts;
drop policy discounts_select_self on discounts;
create policy discounts_select on discounts for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(discounts.student_id)
    or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = discounts.student_id and su.auth_user_id = (select auth.uid()))
  );
