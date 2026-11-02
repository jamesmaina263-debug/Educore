-- WP 4.1: audit log hardening for privileged paths. Additive only: two new trigger functions and
-- three new triggers. No existing function, policy, grant or trigger is edited.
--
-- 1. audit_log becomes append-only at the database level (defence in depth: RLS already gives
--    no insert/update/delete policy, but the owner/service role could still rewrite history).
--    The ONLY bypasses, both owner-level and never reachable by an API role:
--      * educore.school_purge = on          (permanent school purge / trial reset, existing hook)
--      * educore.audit_log_maintenance = on (a reviewed migration that must scrub a value,
--                                            e.g. 20261003160000 removed a leaked token)
-- 2. Privileged tables that had no audit coverage get it:
--      * school_feature_flags : who switched a feature on/off for a school
--      * api_keys             : third-party API credentials (key_hash is redacted, never logged;
--                               last_used_at churn is ignored)
--    A signed-in person with no school_users row in the audited school (platform admin, group
--    admin) is recorded in audit_log.reason as actor_auth_user=<uuid>; calls with no signed-in user
--    are recorded as "system".
--    Deliberately NOT attached to schools or school_subscriptions: signup rollback deletes those
--    rows and an audit row (FK to schools) would make that rollback fail.
-- Rollback: drop the three triggers and the two functions.

create or replace function public.audit_log_block_change()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator', 'service_role')
     and (coalesce(current_setting('educore.school_purge', true), '') = 'on'
          or coalesce(current_setting('educore.audit_log_maintenance', true), '') = 'on') then
    if tg_level = 'ROW' then
      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;
    return null;
  end if;
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$function$;

revoke all on function public.audit_log_block_change() from public, anon, authenticated;

drop trigger if exists trg_audit_log_block_row_change on public.audit_log;
create trigger trg_audit_log_block_row_change
  before update or delete on public.audit_log
  for each row execute function public.audit_log_block_change();

drop trigger if exists trg_audit_log_block_truncate on public.audit_log;
create trigger trg_audit_log_block_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_block_change();

-- Trigger args: [0] column holding the school id (default school_id),
--               [1] comma-separated secret columns (value replaced by a marker),
--               [2] comma-separated noise columns (ignored entirely).
create or replace function public.audit_privileged_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_col text := coalesce(nullif(tg_argv[0], ''), 'school_id');
  v_secret text[] := case when coalesce(tg_argv[1], '') = '' then '{}'::text[] else string_to_array(tg_argv[1], ',') end;
  v_noise text[] := case when coalesce(tg_argv[2], '') = '' then '{}'::text[] else string_to_array(tg_argv[2], ',') end;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_school uuid;
  v_actor uuid;
  v_record uuid;
  v_reason text;
  v_uid uuid := auth.uid();
  v_changed boolean;
  k text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_record := nullif(v_row ->> 'id', '')::uuid;
  v_school := nullif(v_row ->> v_school_col, '')::uuid;
  if v_school is null and jsonb_exists(v_row, 'created_by') then
    select su.school_id into v_school from school_users su where su.id = nullif(v_row ->> 'created_by', '')::uuid;
  end if;

  if v_school is null or v_record is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_uid is not null then
    select su.id into v_actor from school_users su
      where su.auth_user_id = v_uid and su.status = 'active' and su.school_id = v_school
      limit 1;
  end if;
  if v_actor is null then
    v_reason := case
      when v_uid is not null then 'actor_auth_user=' || v_uid::text
      else 'system: no signed-in user (role ' || coalesce(auth.role(), 'none') || ')'
    end;
  end if;

  v_old := case when tg_op = 'INSERT' then null else (to_jsonb(old) - 'updated_at') - v_noise end;
  v_new := case when tg_op = 'DELETE' then null else (to_jsonb(new) - 'updated_at') - v_noise end;

  foreach k in array v_secret loop
    v_changed := tg_op = 'UPDATE' and (v_old -> k) is distinct from (v_new -> k);
    if v_old is not null and jsonb_exists(v_old, k) then
      v_old := jsonb_set(v_old, array[k], to_jsonb('[redacted]'::text));
    end if;
    if v_new is not null and jsonb_exists(v_new, k) then
      v_new := jsonb_set(v_new, array[k],
        to_jsonb(case when v_changed then '[redacted: changed]' else '[redacted]' end::text));
    end if;
  end loop;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
    values (v_school, v_actor, tg_table_name, v_record, 'create', v_reason, v_new);
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data)
    values (v_school, v_actor, tg_table_name, v_record, 'delete', v_reason, v_old);
  elsif v_old is distinct from v_new then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data, new_data)
    values (v_school, v_actor, tg_table_name, v_record, 'update', v_reason, v_old, v_new);
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

revoke all on function public.audit_privileged_change() from public, anon, authenticated;

drop trigger if exists trg_audit_school_feature_flags on public.school_feature_flags;
create trigger trg_audit_school_feature_flags
  after insert or update or delete on public.school_feature_flags
  for each row execute function public.audit_privileged_change('school_id', '', '');

drop trigger if exists trg_audit_api_keys on public.api_keys;
create trigger trg_audit_api_keys
  after insert or update or delete on public.api_keys
  for each row execute function public.audit_privileged_change('school_id', 'key_hash', 'last_used_at');
