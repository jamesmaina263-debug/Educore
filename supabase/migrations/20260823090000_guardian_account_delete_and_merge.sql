-- Root cause (see conversation): delete_student_permanently() only ever purged the
-- `students` row and its history. It never touched `school_users` -- the table that
-- backs every parent/guardian (and staff) identity. Guardians are also frequently
-- duplicated because findOrCreateGuardian() dedupes by phone *within the caller's
-- school only* (school_users_select RLS is school-scoped), so the same person
-- registered at two schools -- or re-entered by mistake -- ends up as two separate
-- school_users rows. There was previously no function capable of permanently
-- removing one of them, so "deleting" a duplicate guardian in the UI could not
-- actually remove anything at the account level: the row, and everything hanging
-- off it, stayed in Supabase.
--
-- This migration adds two RPCs, deliberately scoped to role = 'parent' only.
-- Staff accounts are excluded on purpose: 80+ columns across the schema reference
-- school_users(id) as "who did this" (teacher_id, staff_id, approved_by, marked_by,
-- etc.), several NOT NULL and representing real business/audit history a hard
-- delete should never silently erase. Guardians carry almost none of that.
--
--   1. delete_school_user_permanently(p_school_user_id, p_reason)
--      Irreversibly deletes one guardian identity: snapshots to audit_log, detaches
--      or purges the small set of guardian-specific relations, deletes the linked
--      auth.users row if one exists, then deletes the school_users row itself.
--
--   2. merge_guardian_accounts(p_keep_id, p_duplicate_id, p_reason)
--      The actual fix for "Ethan has two accounts" -- reassigns every relationship
--      (children, PT-meeting bookings, applications, notification history) from the
--      duplicate onto the record you're keeping, so nothing is lost, then calls (1)
--      on the now-orphaned duplicate. Prefer this over a bare delete whenever the
--      duplicate has real history attached to it.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'guardians.delete', true
from public.roles r
where r.name in ('school_owner', 'principal')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Three NOT NULL / NO ACTION FKs to school_users(id) can legitimately be
-- populated by a *guardian*, not just staff, and would otherwise block deleting
-- one outright:
--   - documents.uploaded_by          (a parent can upload a birth certificate/ID
--                                      scan during an application)
--   - document_access_log.accessed_by (insert-only audit trail; a parent viewing
--                                      their child's record/medical file logs here)
--   - mpesa_stk_requests.initiated_by (a parent paying fees via M-Pesa STK push)
-- The rows themselves are real records (a document, a payment attempt, an access
-- event) that must NOT be deleted just because the actor's account later is --
-- same trade-off already used everywhere else in this schema (sent_by,
-- approved_by, dismissed_by, reviewer_id, granted_by, etc.): keep the record,
-- detach the identity. document_access_log stays insert-only -- this only
-- widens the *deletion* path (via FK action), not app-level UPDATE/DELETE grants.
-- ----------------------------------------------------------------------------
alter table public.documents alter column uploaded_by drop not null;
alter table public.documents drop constraint documents_uploaded_by_fkey;
alter table public.documents add constraint documents_uploaded_by_fkey
  foreign key (uploaded_by) references public.school_users(id) on delete set null;

alter table public.document_access_log alter column accessed_by drop not null;
alter table public.document_access_log drop constraint document_access_log_accessed_by_fkey;
alter table public.document_access_log add constraint document_access_log_accessed_by_fkey
  foreign key (accessed_by) references public.school_users(id) on delete set null;

alter table public.mpesa_stk_requests alter column initiated_by drop not null;
alter table public.mpesa_stk_requests drop constraint mpesa_stk_requests_initiated_by_fkey;
alter table public.mpesa_stk_requests add constraint mpesa_stk_requests_initiated_by_fkey
  foreign key (initiated_by) references public.school_users(id) on delete set null;

-- ============================================================================
-- 1. delete_school_user_permanently
-- ============================================================================
create or replace function public.delete_school_user_permanently(p_school_user_id uuid, p_reason text default null)
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
  if not auth_has_permission('guardians.delete') then
    raise exception 'Not authorized to permanently delete a guardian account.';
  end if;

  select su.school_id, su.auth_user_id, r.name
    into v_school_id, v_auth_user_id, v_role_name
  from public.school_users su
  join public.roles r on r.id = su.role_id
  where su.id = p_school_user_id and su.school_id = auth_school_id()
  for update;

  if not found then
    raise exception 'Account not found.';
  end if;

  if v_role_name <> 'parent' then
    raise exception
      'delete_school_user_permanently only supports guardian/parent accounts. Staff accounts carry business history (classes taught, approvals, payroll, etc.) and must be deactivated (school_users.status) rather than hard-deleted.';
  end if;

  v_actor := auth_school_user_id();

  -- Snapshot before anything is touched -- this is the only forensic record left
  -- once the row is gone, same pattern as delete_student_permanently.
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

  -- Guardian-specific relations. student_guardians and fee_threshold_alerts are
  -- already ON DELETE CASCADE and clean themselves up on the final delete below;
  -- everything else here is NOT NULL/NO ACTION (blocks) or a detachable history
  -- record, so it needs explicit handling first.
  delete from public.pt_meeting_bookings where guardian_user_id = p_school_user_id;
  update public.applications set guardian_id = null where guardian_id = p_school_user_id;
  update public.notification_logs set recipient_school_user_id = null where recipient_school_user_id = p_school_user_id;

  -- Defensive catch-all: null out any *other* nullable FK to school_users(id) that
  -- still points at this row (a future column added to a staff-oriented table that
  -- a parent should never legitimately populate, or bad data). NOT NULL / cascade
  -- FKs are skipped here deliberately -- those are handled explicitly above, or are
  -- expected to cascade cleanly on the final delete.
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

  -- Deleting the auth.users row (when one exists) cascades to identities/sessions/
  -- etc. via Supabase's own auth schema, and would also cascade school_users.
  -- Deleted explicitly below regardless, so this works the same for guardians that
  -- were only ever pre-provisioned (auth_user_id null -- see
  -- phase0_step3_school_users_nullable_auth_user_id) and never actually signed in.
  --
  -- Note: this is a raw SQL delete, not the Admin API's auth.admin.deleteUser().
  -- It's correct for data cleanup, but skips any GoTrue-side webhooks/side effects
  -- that call would trigger -- fine for a background/admin operation like this one.
  if v_auth_user_id is not null then
    delete from auth.users where id = v_auth_user_id;
  end if;

  delete from public.school_users where id = p_school_user_id;
end;
$$;

comment on function public.delete_school_user_permanently is
  'Irreversibly deletes a guardian/parent account (school_users row) and its auth.users login, if any. Restricted to role=parent and guardians.delete permission (school_owner/principal by default). Staff accounts are rejected -- deactivate them via school_users.status instead. Writes a full snapshot to audit_log before deleting anything. Prefer merge_guardian_accounts() over this when the account being removed is a duplicate with real history (children, bookings) that should be kept, not lost.';

revoke all on function public.delete_school_user_permanently(uuid, text) from public;
grant execute on function public.delete_school_user_permanently(uuid, text) to authenticated;

-- ============================================================================
-- 2. merge_guardian_accounts
-- ============================================================================
create or replace function public.merge_guardian_accounts(p_keep_id uuid, p_duplicate_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_keep_id = p_duplicate_id then
    raise exception 'Cannot merge an account into itself.';
  end if;

  if not auth_has_permission('guardians.delete') then
    raise exception 'Not authorized to merge guardian accounts.';
  end if;

  perform 1 from public.school_users su join public.roles r on r.id = su.role_id
    where su.id = p_keep_id and su.school_id = auth_school_id() and r.name = 'parent'
    for update;
  if not found then
    raise exception 'Keeper account not found or is not a guardian.';
  end if;

  perform 1 from public.school_users su join public.roles r on r.id = su.role_id
    where su.id = p_duplicate_id and su.school_id = auth_school_id() and r.name = 'parent'
    for update;
  if not found then
    raise exception 'Duplicate account not found or is not a guardian.';
  end if;

  -- Re-link children: keep the keeper's existing relationship where a child is
  -- already linked to both (avoids a duplicate-row conflict), otherwise move the
  -- duplicate's link over.
  update public.student_guardians sg
  set guardian_user_id = p_keep_id
  where sg.guardian_user_id = p_duplicate_id
    and not exists (
      select 1 from public.student_guardians sg2
      where sg2.student_id = sg.student_id and sg2.guardian_user_id = p_keep_id
    );
  delete from public.student_guardians where guardian_user_id = p_duplicate_id;

  update public.pt_meeting_bookings set guardian_user_id = p_keep_id where guardian_user_id = p_duplicate_id;
  update public.applications set guardian_id = p_keep_id where guardian_id = p_duplicate_id;
  update public.notification_logs set recipient_school_user_id = p_keep_id where recipient_school_user_id = p_duplicate_id;
  update public.fee_threshold_alerts set guardian_user_id = p_keep_id where guardian_user_id = p_duplicate_id;

  -- The duplicate is now orphaned of everything worth keeping; remove it the same
  -- audited way a standalone delete would.
  perform public.delete_school_user_permanently(
    p_duplicate_id,
    coalesce(p_reason, 'Merged into ' || p_keep_id::text || ' -- duplicate guardian identity')
  );
end;
$$;

comment on function public.merge_guardian_accounts is
  'Reassigns a duplicate guardian''s children, PT-meeting bookings, applications, notification history, and fee-threshold alerts onto the account being kept, then permanently deletes the now-empty duplicate. This is the correct fix for two accounts that should be one (e.g. the same parent registered twice) -- unlike delete_school_user_permanently alone, it does not lose the duplicate''s relationships.';

revoke all on function public.merge_guardian_accounts(uuid, uuid, text) from public;
grant execute on function public.merge_guardian_accounts(uuid, uuid, text) to authenticated;
