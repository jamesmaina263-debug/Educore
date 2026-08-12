-- Phase 17 (Brief Section 8): Audit logging must cover student edits, fee changes, payment
-- changes, student transfers, boarding allocation changes, medical record changes, discipline
-- changes, staff changes, permission changes, deletions, approvals, and the full admission
-- lifecycle. audit_log itself (Phase 1) already exists with RLS locked to a SELECT-only policy
-- (no insert/update/delete policy for any role, including super_admin, at the RLS layer — writes
-- only ever happen via SECURITY DEFINER functions/triggers that bypass RLS as the function
-- owner), so "protected from unauthorized modification" is already true and needs no new work —
-- confirmed by inspection, not re-implemented.
--
-- Coverage audit before this migration: attendance edits (Phase 1), payments create/reverse/
-- allocate + discounts/expenses approve-reject + fee_waivers revoke (Phase 8), and enrollment
-- completion (Phase 13) already write audit_log entries by hand inside their own SECURITY
-- DEFINER RPCs. Everything else the brief lists — student edits/transfers, fee_structures/
-- fee_items, invoices, boarding allocations, medical records, discipline records/cases, staff
-- (school_users) edits, permission (role_permissions) edits, and the applications table's
-- intermediate status transitions (Phase 10 flagged this exact gap: "no audit_log/history trail
-- for status transitions... not yet added") — had none.
--
-- Rather than hand-adding a bespoke audit insert to every write path across a dozen files
-- (students/new, boarding/actions, settings/actions, health, discipline, admissions/wizard —
-- touching that many working modules is itself a real regression risk for zero architectural
-- benefit), this migration adds ONE generic, reusable trigger mechanism and attaches it to every
-- table above that doesn't already have manual audit coverage. It fires on every INSERT/UPDATE/
-- DELETE regardless of whether the write came from a server action's plain .update() call or an
-- RPC, which is exactly what's needed since most of the tables above (school_users, students,
-- hostel_allocations, etc.) are written via ordinary client-side Supabase calls today, not
-- through a dedicated audited RPC — this is the ONLY mechanism that can see all of them without
-- rewriting each call site. Deliberately NOT attached to student_attendance, payments,
-- payment_allocations, discounts, expenses, or fee_waivers — those already log by hand, and a
-- generic trigger on top would double-log the same event.

-- ============================================================================
-- Generic trigger for tables with their own school_id column.
-- ============================================================================
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
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_record_id := old.id;
  else
    v_school_id := new.school_id;
    v_record_id := new.id;
  end if;

  -- Some rows (e.g. a group_admin's own school_users row, or a platform-default
  -- role_permissions row) legitimately have a null school_id. There's nowhere to file
  -- that audit entry against (audit_log.school_id is not null, correctly, since every
  -- entry must be scoped for RLS) — skip rather than fail the underlying write.
  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    -- Exclude updated_at from the comparison so a save that only touches that column
    -- (set by each table's own set_updated_at trigger) doesn't log a no-op "change".
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change() from public;
revoke execute on function public.audit_row_change() from anon, authenticated;

-- ============================================================================
-- Variant for medical_records, which has no school_id of its own — resolved via
-- student_id -> students.school_id. Medical data is exactly what Section 8 calls out by
-- name; audit_log's existing RLS (audit.read, School Owner/Principal only, same gate the
-- Settings > Audit Log tab already uses) is the protection layer, not omission from the log.
-- ============================================================================
create or replace function public.audit_row_change_via_student()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_student_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  v_student_id := coalesce(new.student_id, old.student_id);
  select st.school_id into v_school_id from students st where st.id = v_student_id;
  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_record_id := old.id; else v_record_id := new.id; end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change_via_student() from public;
revoke execute on function public.audit_row_change_via_student() from anon, authenticated;

-- ============================================================================
-- Variant for fee_items, resolved via fee_structure_id -> fee_structures.school_id.
-- ============================================================================
create or replace function public.audit_row_change_via_fee_structure()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_fee_structure_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  v_fee_structure_id := coalesce(new.fee_structure_id, old.fee_structure_id);
  select fs.school_id into v_school_id from fee_structures fs where fs.id = v_fee_structure_id;
  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_record_id := old.id; else v_record_id := new.id; end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change_via_fee_structure() from public;
revoke execute on function public.audit_row_change_via_fee_structure() from anon, authenticated;

-- ============================================================================
-- Attach: student edits + transfers (a transfer is a status/current_class_id update, which
-- a generic row-diff already captures in full).
-- ============================================================================
create trigger trg_audit_students
  after insert or update or delete on students
  for each row execute function public.audit_row_change();

-- Fee changes.
create trigger trg_audit_fee_structures
  after insert or update or delete on fee_structures
  for each row execute function public.audit_row_change();

create trigger trg_audit_fee_items
  after insert or update or delete on fee_items
  for each row execute function public.audit_row_change_via_fee_structure();

create trigger trg_audit_invoices
  after insert or update or delete on invoices
  for each row execute function public.audit_row_change();

-- Boarding allocation changes.
create trigger trg_audit_hostel_allocations
  after insert or update or delete on hostel_allocations
  for each row execute function public.audit_row_change();

create trigger trg_audit_beds
  after insert or update or delete on beds
  for each row execute function public.audit_row_change();

create trigger trg_audit_dormitories
  after insert or update or delete on dormitories
  for each row execute function public.audit_row_change();

create trigger trg_audit_boarding_houses
  after insert or update or delete on boarding_houses
  for each row execute function public.audit_row_change();

-- Medical record changes.
create trigger trg_audit_medical_records
  after insert or update or delete on medical_records
  for each row execute function public.audit_row_change_via_student();

create trigger trg_audit_sick_bay_visits
  after insert or update or delete on sick_bay_visits
  for each row execute function public.audit_row_change();

-- Discipline changes (Phase 15 landed with no audit coverage of its own).
create trigger trg_audit_discipline_records
  after insert or update or delete on discipline_records
  for each row execute function public.audit_row_change();

create trigger trg_audit_discipline_cases
  after insert or update or delete on discipline_cases
  for each row execute function public.audit_row_change();

-- Staff changes.
create trigger trg_audit_school_users
  after insert or update or delete on school_users
  for each row execute function public.audit_row_change();

-- Permission changes.
create trigger trg_audit_role_permissions
  after insert or update or delete on role_permissions
  for each row execute function public.audit_row_change();

-- Admission lifecycle: closes the Phase 10-flagged gap ("no audit_log/history trail for
-- status transitions"). Complementary to, not a duplicate of, Phase 13's curated
-- 'complete_enrollment' audit entry and the admission_enrollment_history table — this
-- trigger additionally captures every intermediate status change (submitted, under_review,
-- shortlisted, interview_scheduled, accepted, rejected, waitlisted, etc.) that previously
-- left no trail at all.
create trigger trg_audit_applications
  after insert or update or delete on applications
  for each row execute function public.audit_row_change();
