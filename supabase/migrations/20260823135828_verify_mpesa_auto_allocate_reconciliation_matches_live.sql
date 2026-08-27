-- Historical placeholder. Supabase's migration history records this version as applied
-- ("verify_mpesa_auto_allocate_reconciliation_matches_live") but introspection of the current
-- live schema found no corresponding function/table/policy change attributable to it — its
-- name and position in the timeline (same day as the M-Pesa auto-allocate reconciliation work)
-- suggest it was a read-only verification query run directly against production (e.g.
-- confirming a concurrent session's reconcile_pending_mpesa_payments() commit matched what was
-- actually live), not a schema-altering migration. Recorded here as a no-op so the version
-- number isn't silently missing from the repo's migration history.
SELECT 1;
