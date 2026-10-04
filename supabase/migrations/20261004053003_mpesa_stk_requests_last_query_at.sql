-- Additive only: nullable column, no default, no rewrite, no existing data touched.
-- Records when the Daraja STK Query fallback (edge function mpesa-stk-query) last asked Safaricom
-- about a still-pending request. The function claims it atomically
-- (update ... where last_query_at is null or older than 20s) so concurrent pollers and the
-- stale-pending cron can never fire duplicate Daraja queries for the same request.
--
-- Already applied to production under this exact version (recorded in schema_migrations);
-- idempotent so `supabase db push --include-all` is a no-op if it is replayed.
alter table public.mpesa_stk_requests
  add column if not exists last_query_at timestamptz;

comment on column public.mpesa_stk_requests.last_query_at is
  'When the STK Query fallback last asked Daraja about this still-pending request (throttle/claim marker).';
