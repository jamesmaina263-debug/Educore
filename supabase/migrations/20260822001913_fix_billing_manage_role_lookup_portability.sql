-- Supersedes 20260819113326_split_billing_manage_from_billing_read.sql, which hardcoded
-- role_id = '2ac7aada-0039-4d39-ae13-3c3dc185bde7' for school_owner. roles.id is
-- gen_random_uuid()-generated, not a stable/portable value, so a fresh environment rebuild
-- would silently insert this permission against a role_id matching nothing. This version
-- looks the role up by name instead. Zero-behavior-change on this database: the row already
-- exists with the correct role_id, so the unique partial index (role_id, permission_key)
-- WHERE school_id IS NULL makes this a no-op here while fixing portability going forward.

insert into role_permissions (role_id, school_id, permission_key, allowed)
select id, null, 'billing.manage', true
from roles
where name = 'school_owner'
on conflict do nothing;
