-- "Start fresh" for trial schools: a school owner can wipe the test data they entered during a trial, by
-- ticking groups of records, WITHOUT losing the school itself, its staff accounts, roles, subscription,
-- M-Pesa credentials or settings.
--
-- Why not reuse delete_school_permanently: that function removes the whole school (and everything under it)
-- and is super-admin only. This one removes only ticked groups, for one school, and only while the school is
-- still on a trial.
--
-- Safety model (fail-closed):
--   * Callable by service_role ONLY. The Next.js server action first re-checks the owner's password, then
--     calls this with the verified actor id. The function does NOT trust the caller: it re-verifies that the
--     actor is an active school_owner of THIS school, that the school's subscription is `trialing` and not
--     complimentary, and that the typed school name matches.
--   * Every table that is not listed in a group below is KEPT. A table added in future is therefore never
--     wiped by accident; it just isn't offered until it is classified here.
--   * One transaction: any failure (including a foreign-key violation from a table we did not expect) rolls
--     everything back and nothing is deleted.
--   * Groups depend on each other (invoices belong to students, etc.). Missing dependencies are refused with
--     a clear message; the UI ticks them automatically using the same map.
--   * The result is written to platform_admin_activity_log in the same transaction.
--
-- What it does NOT do (the server action does these afterwards, because SQL cannot):
--   * delete uploaded files from Supabase Storage;
--   * delete orphaned parent login accounts from auth.users (this returns the ids that are safe to remove).

create or replace function public.reset_trial_school_data(
  p_school_id uuid,
  p_actor uuid,
  p_groups text[],
  p_confirm_name text,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '5min'
as $$
declare
  -- group -> tables, listed CHILDREN FIRST (the order they are deleted in).
  c_fees constant text[] := array[
    'admission_enrollment_history', 'discounts', 'receipts', 'fee_waivers', 'fee_threshold_alerts',
    'mpesa_statement_lines', 'mpesa_statement_batches', 'mpesa_stk_requests', 'payments', 'invoices'];
  c_academics constant text[] := array[
    'knec_cba_export_batches', 'rubric_criterion_scores', 'competency_marks', 'competency_indicator_ratings',
    'competency_evidence', 'marks', 'report_card_head_comments', 'report_cards', 'student_attendance',
    'assignments', 'exam_papers', 'exam_schedules', 'exams'];
  c_applications constant text[] := array['applications'];
  -- Records from other modules (health, discipline, library, announcements, schemes of work...) that point at
  -- students, classes or terms with no cascade, and would otherwise block wiping those.
  c_other constant text[] := array[
    'library_fines', 'library_reservations', 'library_loans', 'medication_administrations',
    'health_referrals', 'health_emergencies', 'sick_bay_visits', 'welfare_concerns', 'safeguarding_reports',
    'disciplinary_actions', 'discipline_records', 'discipline_cases', 'certificates', 'pt_meeting_slots',
    'schemes_of_work', 'teacher_performance_reviews', 'announcements', 'nemis_sync_batches'];
  c_students constant text[] := array[
    'student_subjects', 'student_financial_accounts', 'student_promotion_history', 'student_risk_scores',
    'student_transport_assignments', 'hostel_allocations', 'students'];
  c_setup constant text[] := array[
    'class_subjects', 'timetable_slots', 'timetable_periods', 'curriculum_strands',
    'curriculum_extraction_batches', 'fee_structures', 'grading_scales', 'assessment_schemes', 'streams',
    'classes', 'subjects', 'terms', 'academic_years'];
  -- Whole-group order: groups that others depend on come LAST.
  c_group_order constant text[] := array['fees', 'academics', 'applications', 'other', 'students', 'setup'];

  v_school public.schools%rowtype;
  v_sub public.school_subscriptions%rowtype;
  v_groups text[];
  v_g text;
  v_tables text[];
  v_tbl text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_group_counts jsonb := '{}'::jsonb;
  v_group_total bigint;
  v_total bigint := 0;
  v_missing text[] := '{}';
  v_parent_ids uuid[] := '{}';
  v_parent_auth uuid[] := '{}';
  v_pid uuid;
  v_pauth uuid;
  v_parents_deleted bigint := 0;
  v_parents_kept bigint := 0;
  v_orphans uuid[];
  v_ref uuid[];
  e record;
  v_snapshot jsonb;
begin
  -- ---------- who is calling, and is this allowed ----------
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_actor is null then
    raise exception 'Missing actor.' using errcode = '42501';
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if v_school.id is null then raise exception 'School not found.'; end if;

  if not exists (
    select 1 from public.school_users su join public.roles r on r.id = su.role_id
    where su.school_id = p_school_id and su.auth_user_id = p_actor
      and r.name = 'school_owner' and su.status = 'active'
  ) then
    raise exception 'Only an active school owner of this school can reset its data.' using errcode = '42501';
  end if;

  select * into v_sub from public.school_subscriptions where school_id = p_school_id;
  if v_sub.id is null or v_sub.status <> 'trialing' or v_sub.complimentary then
    raise exception 'Data can only be reset while the school is on a free trial.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trial_reset:' || p_school_id::text, 0));

  -- ---------- normalise and validate the ticked groups ----------
  v_groups := coalesce(p_groups, '{}');
  if exists (select 1 from unnest(v_groups) g where g <> all (c_group_order)) then
    raise exception 'Unknown data group selected.';
  end if;

  -- Dependencies: you cannot remove X while the things that point at X remain.
  if 'students' = any (v_groups) and not (v_groups @> array['fees', 'academics', 'applications', 'other']) then
    raise exception 'Removing students also requires removing fees, academics, applications and other module records.';
  end if;
  if 'setup' = any (v_groups) and not (v_groups @> array['students', 'fees', 'academics', 'applications', 'other']) then
    raise exception 'Removing classes, terms and fee setup also requires removing students, fees, academics, applications and other module records.';
  end if;

  if not p_dry_run then
    if cardinality(v_groups) = 0 then raise exception 'Select at least one group of data to remove.'; end if;
    if p_confirm_name is null or btrim(p_confirm_name) <> v_school.name then
      raise exception 'The school name you typed does not match "%". Nothing was deleted.', v_school.name;
    end if;
    -- Skip audit_log row copies and bypass the delete-time guards, exactly as the permanent purge does.
    perform set_config('educore.school_purge', 'on', true);
    perform set_config('educore.invoice_hard_delete', 'on', true);
  end if;

  -- ---------- per group, children first ----------
  foreach v_g in array c_group_order loop
    -- In dry-run mode with no groups chosen, report on every group.
    continue when not (v_g = any (v_groups)) and not (p_dry_run and cardinality(v_groups) = 0);

    v_tables := case v_g
      when 'fees' then c_fees when 'academics' then c_academics when 'applications' then c_applications
      when 'other' then c_other when 'students' then c_students else c_setup end;
    v_group_total := 0;

    foreach v_tbl in array v_tables loop
      if to_regclass(format('public.%I', v_tbl)) is null then
        v_missing := v_missing || v_tbl;
        continue;
      end if;
      if p_dry_run and cardinality(v_groups) = 0 then
        execute format('select count(*) from public.%I where school_id = $1', v_tbl) into v_n using p_school_id;
      else
        execute format('delete from public.%I where school_id = $1', v_tbl) using p_school_id;
        get diagnostics v_n = row_count;
      end if;
      if v_n > 0 then v_counts := v_counts || jsonb_build_object(v_tbl, v_n); end if;
      v_group_total := v_group_total + v_n;
    end loop;

    -- Parents and guardians live in school_users (role = parent); they go with the students group.
    if v_g = 'students' then
      select coalesce(array_agg(su.id), '{}') into v_parent_ids
        from public.school_users su join public.roles r on r.id = su.role_id
        where su.school_id = p_school_id and r.name = 'parent';

      if p_dry_run and cardinality(v_groups) = 0 then
        v_parents_deleted := cardinality(v_parent_ids);
      else
        -- One at a time in a sub-block: a parent still referenced by something we do not wipe is KEPT, not
        -- allowed to abort the whole reset.
        foreach v_pid in array v_parent_ids loop
          begin
            select auth_user_id into v_pauth from public.school_users where id = v_pid;
            delete from public.school_users where id = v_pid;
            v_parents_deleted := v_parents_deleted + 1;
            if v_pauth is not null then v_parent_auth := v_parent_auth || v_pauth; end if;
          exception when foreign_key_violation then
            v_parents_kept := v_parents_kept + 1;
          end;
        end loop;
      end if;
      v_group_total := v_group_total + v_parents_deleted;
      if v_parents_deleted > 0 then v_counts := v_counts || jsonb_build_object('school_users(parents)', v_parents_deleted); end if;
    end if;

    v_group_counts := v_group_counts || jsonb_build_object(v_g, v_group_total);
    v_total := v_total + v_group_total;
  end loop;

  perform set_config('educore.school_purge', 'off', true);
  perform set_config('educore.invoice_hard_delete', 'off', true);

  -- Parent logins that nothing references any more (same orphan test as the permanent purge).
  v_orphans := v_parent_auth;
  if not (p_dry_run and cardinality(v_groups) = 0) then
    for e in
      select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
        and c.conparentid = 0 and cardinality(c.conkey) = 1 and c.confdeltype in ('a', 'r', 'c')
    loop
      execute format('select coalesce(array_agg(distinct %I), ''{}'') from %s where %I = any($1)', e.col, e.tbl, e.col)
        into v_ref using v_orphans;
      v_orphans := array(select unnest(v_orphans) except select unnest(v_ref));
    end loop;
  end if;

  v_snapshot := jsonb_build_object(
    'school_id', v_school.id,
    'school_name', v_school.name,
    'dry_run', p_dry_run,
    'groups', to_jsonb(v_groups),
    'rows_by_group', v_group_counts,
    'rows_by_table', v_counts,
    'rows_total', v_total,
    'parents_removed', v_parents_deleted,
    'parents_kept_still_referenced', v_parents_kept,
    'tables_missing_skipped', to_jsonb(v_missing),
    'parent_logins_to_remove', cardinality(v_orphans)
  );

  if not p_dry_run then
    insert into public.platform_admin_activity_log (actor_user_id, actor_email, action, detail)
    values (p_actor, null, 'trial_reset_school_data', v_snapshot);
  end if;

  return v_snapshot || jsonb_build_object('auth_user_ids_to_remove', to_jsonb(v_orphans));
end;
$$;

revoke all on function public.reset_trial_school_data(uuid, uuid, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.reset_trial_school_data(uuid, uuid, text[], text, boolean) to service_role;

comment on function public.reset_trial_school_data(uuid, uuid, text[], text, boolean) is
  'service_role only (called by a server action after re-checking the owner''s password). Wipes ticked groups of test data for a school that is still on a free trial, keeping the school, staff, roles, subscription, M-Pesa credentials and settings. One transaction; any failure rolls back. Returns a snapshot and the orphaned parent login ids to remove.';
