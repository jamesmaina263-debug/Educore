-- Rotates the credentials for two staff/parent accounts whose plaintext passwords were
-- committed directly into migration files in this repo. The repo is public
-- (jamesmaina263-debug/Educore, confirmed visibility: public), so these passwords have been
-- readable by anyone on the internet since the migrations that created them merged:
--   loadtest.staff@educore.test       (school_owner, Gititu High School) -- created 2026-09-17
--   connect.test.guardian@educore.test (parent, Gititu High School)      -- created 2026-08-28
--
-- This does three things per account:
--  1. Replaces auth.users.encrypted_password with a random, nowhere-committed value, so the
--     password published in git history no longer works.
--  2. Suspends the school_users row (status = 'suspended'), so even a valid session/token
--     can't act as staff/parent for this school while this is investigated.
--  3. Deletes any live sessions/refresh_tokens for these auth.users rows, so an already-issued
--     JWT can't keep working past its short-lived access-token expiry (refresh is cut off
--     immediately; this doesn't instantly revoke a still-valid access token, Supabase has no
--     SQL-level kill switch for those, but caps how long any prior login can persist).
--
-- Superseded shortly after by 20260918051554_permanently_delete_exposed_test_accounts.sql,
-- kept as its own migration for the audit trail of exactly what live production ran.

do $$
declare
  v_user_id uuid;
  v_new_password text;
begin
  for v_user_id in
    select id from auth.users where email in ('loadtest.staff@educore.test', 'connect.test.guardian@educore.test')
  loop
    v_new_password := encode(gen_random_bytes(24), 'base64');

    update auth.users
    set encrypted_password = crypt(v_new_password, gen_salt('bf')),
        updated_at = now()
    where id = v_user_id;

    delete from auth.refresh_tokens where user_id = v_user_id::text;
    delete from auth.sessions where user_id = v_user_id;
  end loop;

  update public.school_users
  set status = 'suspended'
  where email in ('loadtest.staff@educore.test', 'connect.test.guardian@educore.test');
end $$;
