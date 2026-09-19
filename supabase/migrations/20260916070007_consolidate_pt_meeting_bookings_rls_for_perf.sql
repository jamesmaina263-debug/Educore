-- Part 13. pt_meeting_bookings had 2 SELECT-only permissive policies.
-- Literal OR, copied verbatim. Applied directly to production via Supabase
-- MCP during the audit and verified live.
drop policy pt_meeting_bookings_select_guardian on public.pt_meeting_bookings;
drop policy pt_meeting_bookings_select_staff on public.pt_meeting_bookings;
create policy pt_meeting_bookings_select on public.pt_meeting_bookings
  for select
  using (
    guardian_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
    or exists (
      select 1 from pt_meeting_slots s
      where s.id = pt_meeting_bookings.slot_id
        and s.school_id = auth_school_id()
        and (
          auth_has_permission('academics.write')
          or s.teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
        )
    )
  );
