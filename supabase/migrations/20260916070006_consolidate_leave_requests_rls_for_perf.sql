-- Part 12. leave_requests had 2 UPDATE-only permissive policies. Note the
-- two original policies have DIFFERENT qual vs with_check
-- (leave_requests_update_own_pending allows a pending request to move to
-- 'pending' or 'cancelled', not just stay 'pending') -- that asymmetry is
-- preserved exactly. Applied directly to production via Supabase MCP during
-- the audit and verified live.
drop policy leave_requests_approve on public.leave_requests;
drop policy leave_requests_update_own_pending on public.leave_requests;
create policy leave_requests_update on public.leave_requests
  for update
  using (
    (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('staff.leave.approve')))
    or (
      staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')
      and status = 'pending'
    )
  )
  with check (
    (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('staff.leave.approve')))
    or (
      staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')
      and status = any (array['pending', 'cancelled'])
    )
  );
