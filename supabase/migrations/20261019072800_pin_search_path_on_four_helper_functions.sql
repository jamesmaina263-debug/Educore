alter function public.kicd_can_manage_source(uuid) set search_path = public, pg_temp;
alter function public._platform_invoice_write_on() set search_path = public, pg_temp;
alter function public._platform_invoice_status_for(numeric, numeric, timestamp with time zone, timestamp with time zone) set search_path = public, pg_temp;
alter function public._platform_invoice_due_at(date, integer) set search_path = public, pg_temp;
