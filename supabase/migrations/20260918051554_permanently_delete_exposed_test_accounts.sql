-- Permanently removes the two accounts whose plaintext passwords were committed to this
-- public repo (rotated/suspended in 20260918051325_rotate_exposed_test_account_credentials.sql
-- as an interim measure; this completes the cleanup per an explicit follow-up request to
-- delete rather than just suspend):
--   loadtest.staff@educore.test        (school_owner, Gititu High School)
--   connect.test.guardian@educore.test (parent, Gititu High School)
--
-- loadtest.staff has zero dependent rows anywhere and deletes cleanly.
-- connect.test.guardian has real Connect-testing fixture data referencing it via RESTRICT
-- foreign keys (connect_item_recipients, connect_item_events, notification_logs) that must be
-- removed first; its student_guardians link is ON DELETE CASCADE and needs no manual step.

do $$
declare
  v_guardian_su_id uuid := '08009889-d39f-41d6-a6e4-fda47b588cbf'; -- connect.test.guardian
  v_loadtest_su_id uuid := '44bc6075-f98e-4859-993c-8f4efba7af37'; -- loadtest.staff
  v_guardian_auth_id uuid := '95a161bb-bcc7-4c0e-b93b-b97c412747d9';
  v_loadtest_auth_id uuid := '06566192-3c0d-4a81-ba51-6514be569ef6';
begin
  -- Clear RESTRICT-protected dependents on connect.test.guardian first.
  delete from public.connect_item_recipients where guardian_user_id = v_guardian_su_id;
  delete from public.connect_item_events where actor_school_user_id = v_guardian_su_id;
  delete from public.notification_logs where sent_by = v_guardian_su_id or recipient_school_user_id = v_guardian_su_id;

  -- school_users delete cascades to student_guardians for the guardian account;
  -- loadtest.staff has no dependents.
  delete from public.school_users where id in (v_guardian_su_id, v_loadtest_su_id);

  delete from auth.identities where user_id in (v_guardian_auth_id, v_loadtest_auth_id);
  delete from auth.users where id in (v_guardian_auth_id, v_loadtest_auth_id);
end $$;
