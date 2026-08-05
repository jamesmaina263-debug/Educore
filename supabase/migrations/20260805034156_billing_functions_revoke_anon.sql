revoke execute on function public.start_trial_subscription(uuid, uuid, integer) from anon;
revoke execute on function public.activate_subscription(uuid, uuid, date) from anon;
revoke execute on function public.suspend_subscription(uuid, text) from anon;
revoke execute on function public.cancel_subscription(uuid, text) from anon;
revoke execute on function public.generate_platform_invoice(uuid, date, date, integer) from anon;
revoke execute on function public.record_platform_payment(uuid, text) from anon;
revoke execute on function public.expire_trials() from anon;
revoke execute on function public.mark_invoices_overdue() from anon;
revoke execute on function public.suspend_schools_with_overdue_invoices(integer) from anon;
