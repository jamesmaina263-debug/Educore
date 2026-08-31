-- GTM Readiness Protocol, PR-13 (Prepare a stable demonstration environment).
--
-- Scope, deliberately narrow: this resets the Announcements module only
-- (the flagship feature demoed in PR-07), not every table in the schema.
-- Demo Academy's fixed school_id (50f09948-2f38-4802-8b19-2efe073197bb, see
-- 20260808194751_create_test_school_owner_demo_academy.sql) has 120+ tables
-- carrying a school_id column, and `students` alone has 40+ referencing
-- tables -- most with ON DELETE NO ACTION/RESTRICT, meaning a generic
-- "wipe every demo-created row" reset would need a hand-verified deletion
-- order across the whole schema. That's real work but a much bigger task
-- than this one; tracked as a known gap, not silently skipped (same
-- deferral pattern as PA-07/08/10 on the announcements module itself).
--
-- What this covers: every demo, in practice, is dirtied by announcements
-- published during the PR-07 walkthrough. Those two tables are fully
-- self-contained (announcement_recipients -> announcements is ON DELETE
-- CASCADE, and neither is referenced by anything else), so deleting them
-- for Demo Academy is safe and complete -- no FK cleanup elsewhere needed.

create or replace function public.reset_demo_academy_announcements()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_demo_academy_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
begin
  if not auth_is_super_admin() then
    raise exception 'Only platform admins can reset the demo environment.';
  end if;

  -- announcement_recipients cascades automatically, but deleted explicitly
  -- for a clear row count in the returned notice.
  delete from public.announcement_recipients
  where announcement_id in (
    select id from public.announcements where school_id = v_demo_academy_id
  );

  delete from public.announcements
  where school_id = v_demo_academy_id;
end;
$function$;

revoke execute on function public.reset_demo_academy_announcements() from public;
revoke execute on function public.reset_demo_academy_announcements() from anon;
grant execute on function public.reset_demo_academy_announcements() to authenticated;
