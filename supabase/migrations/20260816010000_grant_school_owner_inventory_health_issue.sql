-- Follow-up to 20260816000000_grant_school_owner_health_write.sql: that grant covered
-- Health module actions (check-in, notify guardian), but accepting/rejecting a medical
-- inventory transfer is gated by a separate permission, inventory.health.issue, which
-- school_owner still didn't have. Lucy hit "insufficient permissions:
-- inventory.health.issue required" when clicking Confirm on a pending transfer.
--
-- Applied directly to the live project (alzqlvfaftwegptfbfej) via Supabase MCP; this
-- file brings migration history back in sync with that.

insert into role_permissions (role_id, permission_key)
select r.id, 'inventory.health.issue'
from roles r
where r.name = 'school_owner'
on conflict do nothing;
