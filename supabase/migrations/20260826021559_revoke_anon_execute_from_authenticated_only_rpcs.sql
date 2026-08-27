-- Defense-in-depth cleanup following the SECURITY DEFINER function audit: 25 functions
-- (student/guardian deletion, payroll generation, inventory writes, admission edits,
-- biometric gate config, etc.) were executable by the `anon` role -- almost certainly
-- Postgres's default EXECUTE-to-PUBLIC grant on function creation, never a deliberate
-- choice, since none of these should ever legitimately run pre-authentication.
--
-- Individually verified every one of them is NOT currently exploitable: each has an
-- unconditional auth_has_permission(...) or (auth_is_super_admin() OR auth.role() =
-- 'service_role') check as its first statement, and auth_has_permission() correctly
-- evaluates false for anon (no matching school_users row), while auth.role() correctly
-- distinguishes anon's JWT role claim from service_role's. So this is risk reduction,
-- not a fix for something exploitable today -- but it closes the exact class of bug
-- that DID make reconcile_pending_mpesa_payments exploitable (a body that trusted
-- "auth.uid() is null" as a proxy for "trusted caller" combined with a leftover anon
-- grant). Removing anon's access removes that risk pre-emptively for all of these,
-- and for anything written this way in the future.

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
