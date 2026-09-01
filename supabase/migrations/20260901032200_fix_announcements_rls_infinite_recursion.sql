-- Bug found while gathering PR-07 evidence (GTM Readiness Protocol): a guardian
-- querying `announcements` or `announcement_recipients` got "infinite recursion
-- detected in policy". Confirmed live: a real guardian session (Test Parent,
-- Demo Academy) could not read a published announcement targeted at them.
--
-- Cause: announcements_select's guardian branch (from
-- 20260831140100_announcements_permissions_rls_rpcs.sql) does
--   EXISTS (SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = announcements.id AND ar.guardian_user_id = auth_school_user_id())
-- and announcement_recipients_select's staff branch does the mirror-image
--   EXISTS (SELECT 1 FROM announcements a WHERE a.id = announcement_recipients.announcement_id AND <staff perm check>)
-- Postgres detects this as a circular policy dependency between the two tables
-- at the rewrite stage -- it doesn't matter that the guardian branch's own
-- guardian_user_id = auth_school_user_id() check is cheap/true; the cross-table
-- EXISTS is still structurally recursive.
--
-- Fix (same pattern already used elsewhere in this schema for auth_is_super_admin(),
-- auth_has_permission(), etc.): two small SECURITY DEFINER helper functions that
-- read the *other* table directly, bypassing that table's RLS entirely, so
-- neither policy's evaluation re-enters the other table's policy.
--
-- Already applied directly to production on 2026-08-31 (before this migration
-- file existed, same drift pattern as walk_in_screening_confirmation_gate) --
-- this file exists so a fresh environment/branch matches what's actually live.

create or replace function public.auth_is_announcement_recipient(p_announcement_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.announcement_recipients ar
    where ar.announcement_id = p_announcement_id
      and ar.guardian_user_id = auth_school_user_id()
  );
$function$;

revoke execute on function public.auth_is_announcement_recipient(uuid) from public;
revoke execute on function public.auth_is_announcement_recipient(uuid) from anon;
grant execute on function public.auth_is_announcement_recipient(uuid) to authenticated;

create or replace function public.auth_can_manage_announcement(p_announcement_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and (
        auth_is_super_admin()
        or (a.school_id = auth_school_id() and auth_has_permission('announcements.publish'))
        or (a.created_by = auth_school_user_id())
      )
  );
$function$;

revoke execute on function public.auth_can_manage_announcement(uuid) from public;
revoke execute on function public.auth_can_manage_announcement(uuid) from anon;
grant execute on function public.auth_can_manage_announcement(uuid) to authenticated;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
for select using (
  auth_is_super_admin()
  or (school_id = auth_school_id() and auth_has_permission('announcements.publish'))
  or (created_by = auth_school_user_id())
  or (status = 'published' and auth_is_announcement_recipient(id))
);

drop policy if exists announcement_recipients_select on public.announcement_recipients;
create policy announcement_recipients_select on public.announcement_recipients
for select using (
  guardian_user_id = auth_school_user_id()
  or auth_can_manage_announcement(announcement_id)
);
