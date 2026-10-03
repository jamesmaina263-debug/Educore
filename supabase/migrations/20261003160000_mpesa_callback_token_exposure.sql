-- Security audit (finance / medical / marks policy review, 2026-10-03), findings F1 + F2.
--
-- F1. mpesa_settings.callback_token is the shared secret in the Daraja callback URL
--     (/mpesa-stk-callback/<school_id>/<callback_token>); the callback function documents it as
--     "never displayed in the UI" and as the primary defense, with the Safaricom IP allowlist as
--     a second, independent layer. In practice it was readable two ways by ordinary staff:
--       (a) mpesa_settings_select lets any user with finance.read SELECT the whole row, so the
--           token was one PostgREST call away (`?select=callback_token`);
--       (b) audit_row_change() copies the full row (to_jsonb(new)) into audit_log, and
--           audit_log is readable with audit.read -- 3 existing rows contained the token.
--     Fixes: column-level SELECT (callback_token is now service_role-only); redact secret keys in
--     the shared audit trigger; scrub the existing audit rows. No app code reads the column as a
--     user: every app query lists its columns explicitly, the two edge functions use the
--     service-role key, and every SQL function touching the table is SECURITY DEFINER.
--     The token should still be ROTATED once (it was exposed to staff with those permissions):
--       update public.mpesa_settings set callback_token = encode(gen_random_bytes(24), 'hex');
--     Do that at a quiet time -- STK pushes already in flight carry the old token in their URL.
--
-- F2. reconcile_pending_mpesa_payments(uuid, uuid) is SECURITY DEFINER, verifies the school but
--     has no permission check, and was executable by every authenticated user (teachers,
--     parents, students could trigger payment allocation). Nothing calls it: no app code, no
--     edge function, no live SQL function or view depends on it, and the API logs show no calls.
--     Revoke EXECUTE from authenticated; service_role keeps it.
--
-- Idempotent; fails closed (the verification block raises and rolls everything back).
--
-- Rollback:
--   grant select on public.mpesa_settings to authenticated;
--   grant execute on function public.reconcile_pending_mpesa_payments(uuid, uuid) to authenticated;
--   (audit_row_change: re-create the previous definition, which lacks the v_secret_keys redaction.)

-- 1. F1a: callback_token readable by service_role only. Any new column on this table must be added
--    to this grant list explicitly if the app needs to read it as a user (secure by default).
revoke select on public.mpesa_settings from anon, authenticated;
grant select (id, school_id, shortcode, shortcode_type, environment, is_active,
              credentials_saved, updated_at, updated_by)
  on public.mpesa_settings to authenticated;

-- 2. F1b: never copy secret columns into audit_log. Same definition as before, plus redaction.
--    The UPDATE branch still compares the un-redacted rows, so a token-only rotation is still
--    recorded as an event (with the secret removed from both sides).
create or replace function public.audit_row_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_secret_keys constant text[] := array['callback_token'];
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_record_id := old.id;
  else
    v_school_id := new.school_id;
    v_record_id := new.id;
  end if;

  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new) - v_secret_keys);
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old) - v_secret_keys);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update',
              v_old - v_secret_keys, v_new - v_secret_keys);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

-- 3. F1c: remove the token from audit rows already written (touches only that one key).
update public.audit_log
   set old_data = old_data - 'callback_token',
       new_data = new_data - 'callback_token'
 where table_name = 'mpesa_settings'
   and (jsonb_exists(old_data, 'callback_token') or jsonb_exists(new_data, 'callback_token'));

-- 4. F2: dead, permission-less RPC no longer callable by ordinary users.
revoke execute on function public.reconcile_pending_mpesa_payments(uuid, uuid) from authenticated;

-- 5. Verify; raise (rolling back this migration) if any of it did not take effect.
do $verify$
begin
  if has_column_privilege('authenticated', 'public.mpesa_settings', 'callback_token', 'SELECT')
     or has_column_privilege('anon', 'public.mpesa_settings', 'callback_token', 'SELECT') then
    raise exception 'F1: callback_token is still readable by anon/authenticated';
  end if;
  if not has_column_privilege('authenticated', 'public.mpesa_settings', 'credentials_saved', 'SELECT')
     or not has_column_privilege('authenticated', 'public.mpesa_settings', 'is_active', 'SELECT') then
    raise exception 'F1: authenticated lost SELECT on columns the app reads';
  end if;
  if not has_column_privilege('service_role', 'public.mpesa_settings', 'callback_token', 'SELECT') then
    raise exception 'F1: service_role must keep SELECT on callback_token (edge functions need it)';
  end if;
  if exists (select 1 from public.audit_log
              where table_name = 'mpesa_settings'
                and (jsonb_exists(old_data, 'callback_token') or jsonb_exists(new_data, 'callback_token'))) then
    raise exception 'F1: callback_token still present in audit_log';
  end if;
  if has_function_privilege('authenticated', 'public.reconcile_pending_mpesa_payments(uuid, uuid)', 'EXECUTE') then
    raise exception 'F2: authenticated can still execute reconcile_pending_mpesa_payments';
  end if;
  if not has_function_privilege('service_role', 'public.reconcile_pending_mpesa_payments(uuid, uuid)', 'EXECUTE') then
    raise exception 'F2: service_role lost EXECUTE on reconcile_pending_mpesa_payments';
  end if;
end
$verify$;
