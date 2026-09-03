-- idx_invoices_school_status and invoices_school_id_status_idx are byte-identical
-- (both: btree on invoices(school_id, status)). Postgres has to maintain both on
-- every INSERT/UPDATE for zero query-planning benefit. Flagged by Supabase's
-- performance advisor (duplicate_index). Keeping the more descriptively-named one.
DROP INDEX IF EXISTS public.idx_invoices_school_status;
