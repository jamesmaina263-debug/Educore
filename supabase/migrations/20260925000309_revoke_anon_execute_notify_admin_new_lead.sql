-- H6 anon-execute drift fix: notify_admin_new_lead() (20260920093734_lead_magnet_admin_notifications.sql)
-- is a trigger function only ever invoked by trg_notify_admin_new_lead on public.marketing_leads insert.
-- Postgres grants EXECUTE to PUBLIC by default on new functions unless revoked; this one was missed
-- when added, unlike its same-week sibling notify_admin_new_demo_partial_lead() which already revokes
-- correctly (20260921140000_demo_partial_lead_notifications.sql). Trigger firing is unaffected by this
-- grant either way. No behavior change; closes the flagged gap in the anon-execute drift check.
revoke all on function public.notify_admin_new_lead() from public, anon, authenticated;
