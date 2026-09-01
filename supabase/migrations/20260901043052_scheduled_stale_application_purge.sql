-- Lucy's follow-up: rejected applications should be purged automatically after
-- 14 days, not only when an officer remembers to click "Delete permanently."
--
-- This does three things:
--
--   1. Splits delete_school_user_permanently() into a thin, authorization-checked
--      public wrapper and a private _delete_school_user_permanently_impl() that
--      does the actual work. The public function still requires the caller to
--      hold guardians.delete and own the account within their own school
--      (auth_school_id()) -- unchanged behaviour for every existing caller
--      (Parents directory delete button, delete_application_permanently's
--      cascade). The private impl has no auth/session dependency, so it can
--      also be called from a background job with no authenticated user at all.
--
--   2. list_purge_candidates(p_days) -- read-only. Returns the storage
--      bucket/path of every document attached to a rejected/withdrawn
--      application whose decision is older than p_days, so a caller can
--      remove the actual storage objects first (same ordering the manual
--      deleteApplicationPermanentlyAction already uses -- storage isn't
--      reachable from SQL).
--
--   3. purge_stale_non_admitted_applications(p_days) -- does the real
--      deletion: for every rejected/withdrawn application whose decision is
--      older than p_days, deletes the application (same core steps as
--      delete_application_permanently), then purges the guardian via the
--      private impl if they're left with no other application and no
--      admitted/enrolled child. Returns one row per application purged, for
--      the caller to log.
--
-- Both new functions are revoked from anon/authenticated -- they're only ever
-- meant to run from the scheduled GitHub Actions job (purge-stale-applications.yml),
-- which connects as the migration-owning role via SUPABASE_DB_URL, the same way
-- nightly-backup.yml and migration-drift-check.yml already do. Nothing in the
-- app itself ever calls these two.

create or replace function public._delete_school_user_permanently_impl(p_school_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
  v_actor uuid;
  v_auth_user_id uuid;
  v_role_name text;
  v_snapshot jsonb;
  v_col record;
begin
  select su.school_id, su.auth_user_id, r.name
    into v_school_id, v_auth_user_id, v_role_name
  from public.school_users su
  join public.roles r on r.id = su.role_id
  where su.id = p_school_user_id
  for update;

  if not found then
    raise exception 'Account not found.';
  end if;

  if v_role_name <> 'parent' then
    raise exception
      '_delete_school_user_permanently_impl only supports guardian/parent accounts. Staff accounts carry business history (classes taught, approvals, payroll, etc.) and must be deactivated (school_users.status) rather than hard-deleted.';
  end if;

  -- auth_school_user_id() resolves to null when there's no authenticated caller
  -- (a background job) -- audit_log.actor_school_user_id is nullable, so this
  -- is fine and just records "system" the same way any other null actor would.
  v_actor := auth_school_user_id();

  select to_jsonb(su.*) || jsonb_build_object(
    'reason', p_reason,
    'role', v_role_name,
    'related_record_counts', jsonb_build_object(
      'student_guardians', (select count(*) from public.student_guardians where guardian_user_id = p_school_user_id),
      'pt_meeting_bookings', (select count(*) from public.pt_meeting_bookings where guardian_user_id = p_school_user_id),
      'applications_detached', (select count(*) from public.applications where guardian_id = p_school_user_id),
      'notification_logs_detached', (select count(*) from public.notification_logs where recipient_school_user_id = p_school_user_id),
      'had_auth_user', (v_auth_user_id is not null)
    )
  ) into v_snapshot
  from public.school_users su
  where su.id = p_school_user_id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
  values (v_school_id, v_actor, 'school_users', p_school_user_id, 'permanent_delete', v_snapshot);

  delete from public.pt_meeting_bookings where guardian_user_id = p_school_user_id;
  update public.applications set guardian_id = null where guardian_id = p_school_user_id;
  update public.notification_logs set recipient_school_user_id = null where recipient_school_user_id = p_school_user_id;

  for v_col in
    select kcu.table_schema, kcu.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.columns col
      on col.table_schema = kcu.table_schema and col.table_name = kcu.table_name and col.column_name = kcu.column_name
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = 'school_users'
      and ccu.column_name = 'id'
      and tc.table_schema = 'public'
      and col.is_nullable = 'YES'
      and not (kcu.table_name = 'applications' and kcu.column_name = 'guardian_id')
      and not (kcu.table_name = 'notification_logs' and kcu.column_name = 'recipient_school_user_id')
  loop
    execute format(
      'update %I.%I set %I = null where %I = $1',
      v_col.table_schema, v_col.table_name, v_col.column_name, v_col.column_name
    ) using p_school_user_id;
  end loop;

  if v_auth_user_id is not null then
    delete from auth.users where id = v_auth_user_id;
  end if;

  delete from public.school_users where id = p_school_user_id;
end;
$$;

revoke all on function public._delete_school_user_permanently_impl(uuid, text) from public, anon, authenticated;

-- Public wrapper: same signature/behaviour as before this migration, just
-- delegating the actual work to the impl above once authorization passes.
create or replace function public.delete_school_user_permanently(p_school_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_has_permission('guardians.delete') then
    raise exception 'Not authorized to permanently delete a guardian account.';
  end if;

  if not exists (
    select 1 from public.school_users
    where id = p_school_user_id and school_id = auth_school_id()
  ) then
    raise exception 'Account not found.';
  end if;

  perform public._delete_school_user_permanently_impl(p_school_user_id, p_reason);
end;
$$;

comment on function public.delete_school_user_permanently is
  'Irreversibly deletes a guardian/parent account (school_users row) and its auth.users login, if any. Restricted to role=parent and guardians.delete permission (school_owner/principal by default), and only within the caller''s own school. Writes a full snapshot to audit_log before deleting anything. Prefer merge_guardian_accounts() over this when the account being removed is a duplicate with real history (children, bookings) that should be kept, not lost.';

revoke all on function public.delete_school_user_permanently(uuid, text) from public;
grant execute on function public.delete_school_user_permanently(uuid, text) to authenticated;

-- ============================================================================
-- Scheduled 14-day retention job support
-- ============================================================================

create or replace function public.list_purge_candidates(p_days integer default 14)
returns table(application_id uuid, application_number text, storage_bucket text, storage_path text)
language sql
security definer
set search_path to 'public'
stable
as $$
  select a.id, a.application_number, d.storage_bucket, d.storage_path
  from public.applications a
  join public.documents d on d.application_id = a.id
  where a.status in ('rejected', 'withdrawn')
    and coalesce(a.decision_at, a.updated_at) < now() - (p_days || ' days')::interval;
$$;

revoke all on function public.list_purge_candidates(integer) from public, anon, authenticated;

create or replace function public.purge_stale_non_admitted_applications(p_days integer default 14)
returns table(purged_application_id uuid, application_number text, guardian_purged boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app record;
  v_remaining_applications integer;
  v_remaining_children integer;
  v_guardian_purged boolean;
begin
  -- Table aliased and columns qualified deliberately: the OUT parameter
  -- application_number below would otherwise shadow applications.application_number
  -- inside this SELECT, which plpgsql resolves to the OUT parameter (always null at
  -- this point) rather than the table column -- caught by testing this function
  -- against real data before shipping it, not by inspection.
  for v_app in
    select a.id, a.application_number, a.guardian_id
    from applications a
    where a.status in ('rejected', 'withdrawn')
      and coalesce(a.decision_at, a.updated_at) < now() - (p_days || ' days')::interval
  loop
    v_guardian_purged := false;

    delete from admission_enrollment_history where application_id = v_app.id;

    -- documents rows (and their storage objects, already removed by the caller
    -- via list_purge_candidates before this runs) cascade automatically.
    delete from applications where id = v_app.id;

    if v_app.guardian_id is not null then
      select count(*) into v_remaining_applications
      from applications where guardian_id = v_app.guardian_id;

      select count(*) into v_remaining_children
      from student_guardians where guardian_user_id = v_app.guardian_id;

      if v_remaining_applications = 0 and v_remaining_children = 0 then
        begin
          perform public._delete_school_user_permanently_impl(
            v_app.guardian_id,
            format('Auto-purged by scheduled %s-day retention job: application %s (%s) was rejected/withdrawn and expired', p_days, v_app.id, v_app.application_number)
          );
          v_guardian_purged := true;
        exception when others then
          raise warning 'purge_stale_non_admitted_applications: guardian cleanup for % failed: %', v_app.guardian_id, sqlerrm;
        end;
      end if;
    end if;

    purged_application_id := v_app.id;
    application_number := v_app.application_number;
    guardian_purged := v_guardian_purged;
    return next;
  end loop;
end;
$$;

revoke all on function public.purge_stale_non_admitted_applications(integer) from public, anon, authenticated;

comment on function public.purge_stale_non_admitted_applications is
  'Scheduled 14-day retention: permanently deletes rejected/withdrawn applications past p_days since decision, plus their guardian account when left with no other application or admitted child. Called only by the purge-stale-applications.yml GitHub Actions job -- never from the app. Caller must remove list_purge_candidates() storage objects first.';
