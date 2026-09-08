-- Dunning / overdue-invoice follow-up (platform admin gap): platform_invoices already tracks
-- status/due_at, and mark_invoices_overdue()/suspend_schools_with_overdue_invoices() (both
-- run daily via /api/cron/billing) already flip status to 'overdue' and eventually suspend the
-- school after a 7-day grace period -- but nothing closes the loop with the school in between.
-- This column just tracks "has a human reminder gone out, and when" so /admin/billing's new
-- dunning list can show that and avoid the admin re-sending blind.
alter table public.platform_invoices
  add column reminder_sent_at timestamptz;
