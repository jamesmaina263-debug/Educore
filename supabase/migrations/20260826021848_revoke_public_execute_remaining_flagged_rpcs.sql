
-- These functions had EXECUTE granted to PUBLIC (the Postgres default for new
-- functions), which anon inherits regardless of any direct anon-level revoke.
-- Revoke from PUBLIC, then re-grant explicitly to authenticated so the app's
-- logged-in users are unaffected.

revoke execute on function public.accept_inventory_transfer(uuid, integer) from public;
grant execute on function public.accept_inventory_transfer(uuid, integer) to authenticated;

revoke execute on function public.approve_health_stock_adjustment(uuid) from public;
grant execute on function public.approve_health_stock_adjustment(uuid) to authenticated;

revoke execute on function public.assign_admission_number() from public;
grant execute on function public.assign_admission_number() to authenticated;

revoke execute on function public.create_health_inventory_item(text, text, integer, date, uuid) from public;
grant execute on function public.create_health_inventory_item(text, text, integer, date, uuid) to authenticated;

revoke execute on function public.create_inventory_item(text, text, integer, text, integer, text, uuid) from public;
grant execute on function public.create_inventory_item(text, text, integer, text, integer, text, uuid) to authenticated;

revoke execute on function public.create_inventory_transfer(uuid, integer) from public;
grant execute on function public.create_inventory_transfer(uuid, integer) to authenticated;

revoke execute on function public.default_inventory_item_category() from public;
grant execute on function public.default_inventory_item_category() to authenticated;

revoke execute on function public.enforce_leave_request_gender() from public;
grant execute on function public.enforce_leave_request_gender() to authenticated;

revoke execute on function public.enforce_single_primary_guardian() from public;
grant execute on function public.enforce_single_primary_guardian() to authenticated;

revoke execute on function public.generate_payroll_record(uuid, smallint, smallint, numeric, numeric, text, jsonb, jsonb) from public;
grant execute on function public.generate_payroll_record(uuid, smallint, smallint, numeric, numeric, text, jsonb, jsonb) to authenticated;

revoke execute on function public.get_staff_statutory_numbers(uuid[]) from public;
grant execute on function public.get_staff_statutory_numbers(uuid[]) to authenticated;

revoke execute on function public.group_schools_summary(uuid) from public;
grant execute on function public.group_schools_summary(uuid) to authenticated;

revoke execute on function public.issue_health_stock(uuid, integer, text) from public;
grant execute on function public.issue_health_stock(uuid, integer, text) to authenticated;

revoke execute on function public.marks_recompute_rankings_on_correction() from public;
grant execute on function public.marks_recompute_rankings_on_correction() to authenticated;

revoke execute on function public.prevent_assignment_submission_self_grading() from public;
grant execute on function public.prevent_assignment_submission_self_grading() to authenticated;

revoke execute on function public.queue_health_alert(uuid, uuid[], text) from public;
grant execute on function public.queue_health_alert(uuid, uuid[], text) to authenticated;

revoke execute on function public.record_goods_received(uuid, uuid, integer) from public;
grant execute on function public.record_goods_received(uuid, uuid, integer) to authenticated;

revoke execute on function public.reject_health_stock_adjustment(uuid, text) from public;
grant execute on function public.reject_health_stock_adjustment(uuid, text) to authenticated;

revoke execute on function public.reject_inventory_transfer(uuid, text) from public;
grant execute on function public.reject_inventory_transfer(uuid, text) to authenticated;

revoke execute on function public.request_health_stock_adjustment(uuid, integer, text) from public;
grant execute on function public.request_health_stock_adjustment(uuid, integer, text) to authenticated;

revoke execute on function public.seed_default_document_requirements() from public;
grant execute on function public.seed_default_document_requirements() to authenticated;

revoke execute on function public.seed_default_inventory_categories() from public;
grant execute on function public.seed_default_inventory_categories() to authenticated;

revoke execute on function public.seed_default_leave_types() from public;
grant execute on function public.seed_default_leave_types() to authenticated;

revoke execute on function public.send_fee_threshold_alert(uuid) from public;
grant execute on function public.send_fee_threshold_alert(uuid) to authenticated;

revoke execute on function public.update_staff_statutory_numbers(uuid, text, text, text, text) from public;
grant execute on function public.update_staff_statutory_numbers(uuid, text, text, text, text) to authenticated;
