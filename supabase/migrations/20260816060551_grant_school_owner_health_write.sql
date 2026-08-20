-- Lucy asked to test the Health module's write actions (sick bay check-in, guardian
-- notification, medical inventory transfer accept/reject) but school_owner only had
-- health.read_any, not health.write -- every write action was correctly built and
-- wired up in the UI, but permission-gated away from the owner's own account, showing
-- up as "no button" since canWrite was false.
--
-- Decision (Lucy, 2026-08-16): the school owner should have full access as the account
-- admin, not be read-only on medical data. Grants health.write to school_owner.
--
-- Applied directly to the live project (alzqlvfaftwegptfbfej) via Supabase MCP; this
-- file brings migration history back in sync with that.

insert into role_permissions (role_id, permission_key)
select r.id, 'health.write'
from roles r
where r.name = 'school_owner'
on conflict do nothing;
