-- PA-10 evidence-gathering (2026-09-08) found a real bug: the announcements_select
-- RLS policy's guardian/student branch required status = 'published', silently
-- excluding withdrawn announcements entirely. This directly contradicts the
-- design intent already stated in withdraw_announcement()'s own migration comment
-- ("Recipients rows are kept (not deleted) so read/ack history survives the
-- withdrawal, per PA-13's audit requirement") and breaks PA-10's DoD ("guardians
-- can search or filter current and previous notices") -- a withdrawn notice is
-- exactly a previous notice. Confirmed live: withdrawing a test announcement made
-- it vanish entirely from the guardian's fetch, even though a real
-- announcement_recipients row still existed for them, and even though the client
-- component (portal-announcements.tsx) already has real, currently-unreachable
-- rendering logic for a withdrawn state (dimmed card, "Withdrawn" badge, the
-- withdrawal reason) that could never have rendered before this fix.
--
-- A withdrawn announcement can, by withdraw_announcement()'s own guard, only ever
-- have come from a published one -- so "published or withdrawn" is the complete,
-- correct set of statuses a recipient should ever see, not an expansion of scope.

drop policy announcements_select on announcements;
create policy announcements_select on announcements for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('announcements.publish'))
  or (created_by = auth_school_user_id())
  or ((status = any (array['published','withdrawn'])) and auth_is_announcement_recipient(id))
);
