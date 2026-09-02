-- SD-10 (GTM Readiness Protocol): school-level data import (onboarding
-- migration from another system) + extending data export to Principal.
--
-- Part 1 -- Export: SD-09 only granted 'settings.data_export' to
-- school_owner. Principal is defined platform-wide as "Full access across
-- the school" (same description as school_owner -- see phase0_step2), so
-- withholding portability from that role was an oversight, not a deliberate
-- restriction. Grant it the same permission, the same way SD-09 did for
-- school_owner.
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'settings.data_export', true
from public.roles r
where r.name = 'principal'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'settings.data_export'
  );

-- Part 2 -- Import: a new school onboarded from another system needs to get
-- its existing records (academic structure, students, guardians) into
-- EduCore in bulk rather than typed in one at a time. Scoped to the same
-- "core operational record" the export covers, minus Invoices/Payments
-- (importing historical financial transactions from an unknown source
-- system's data model is a materially different, higher-risk problem --
-- e.g. it would need to reconcile against no pre-existing ledger state --
-- and is deliberately left for a later iteration if a school actually asks).
--
-- Staff import is NOT one of the SQL functions below: every staff account
-- needs a real Supabase auth user (see inviteStaffMember() in
-- settings/actions.ts, which calls auth.admin.createUser()), and that has to
-- go through the Admin API from application code, not from inside a
-- SECURITY DEFINER SQL function. The bulk staff import route
-- (bulkImportStaffAction in data-import-actions.ts) instead loops over rows
-- and reuses that exact same account-creation path, one admin-API call per
-- row, permission-gated by 'settings.data_import' at the top of the action
-- before it ever touches the Admin API.
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'settings.data_import', true
from public.roles r
where r.name in ('school_owner', 'principal')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'settings.data_import'
  );

-- ============================================================================
-- Shared per-row shape: every function below takes p_rows jsonb (a JSON array
-- of row objects, keys matching the column names documented per function),
-- processes each row in its own sub-transaction so one bad row never aborts
-- the rest of the file, and returns table(row_number, status, message) --
-- exactly the bulk_upsert_timetable_slots() convention already in this repo,
-- so the frontend's existing "per-row ok/error" results UI works unchanged.
--
-- Import order matters and is enforced by the caller (importSchoolData() in
-- data-import-actions.ts), not by these functions themselves: Academic Years
-- -> Terms -> Classes -> Streams -> Subjects -> Students -> Guardians. Each
-- function resolves its parent records by name within the caller's own
-- school (auth_school_id()), so a row referencing a parent that hasn't been
-- imported yet fails with a clear per-row message rather than a cryptic FK
-- error.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Academic Years. Row keys: name, start_date, end_date, status (optional,
-- default 'upcoming'). Upserts on (school_id, name), so re-uploading the same
-- file after fixing a typo just updates the existing row.
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_academic_years(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_name text;
  v_start date;
  v_end date;
  v_status text;
  v_id uuid;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_name := nullif(trim(both from (v_row->>'name')), '');
      v_status := coalesce(nullif(trim(both from lower(v_row->>'status')), ''), 'upcoming');
      if v_name is null then
        raise exception 'Name is required.';
      end if;
      begin
        v_start := nullif(trim(both from (v_row->>'start_date')), '')::date;
        v_end := nullif(trim(both from (v_row->>'end_date')), '')::date;
      exception when others then
        raise exception 'Start Date and End Date must be valid dates (YYYY-MM-DD).';
      end;
      if v_start is null or v_end is null then
        raise exception 'Start Date and End Date are required.';
      end if;
      if v_status not in ('upcoming', 'active', 'closed') then
        raise exception 'Status must be one of upcoming, active, closed (got "%").', v_status;
      end if;

      insert into academic_years (school_id, name, start_date, end_date, status)
      values (v_school_id, v_name, v_start, v_end, v_status)
      on conflict (school_id, name)
      do update set start_date = excluded.start_date, end_date = excluded.end_date, status = excluded.status
      returning id into v_id;

      row_number := v_idx; status := 'ok'; message := format('%s imported.', v_name);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_academic_years(jsonb) from public, anon;
grant execute on function public.bulk_import_academic_years(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Terms. Row keys: academic_year_name, name, term_number, start_date,
-- end_date, status (optional, default 'upcoming'). Upserts on
-- (academic_year_id, term_number).
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_terms(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_year_name text;
  v_year_id uuid;
  v_name text;
  v_term_number int;
  v_start date;
  v_end date;
  v_status text;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_year_name := nullif(trim(both from (v_row->>'academic_year_name')), '');
      v_name := nullif(trim(both from (v_row->>'name')), '');
      v_status := coalesce(nullif(trim(both from lower(v_row->>'status')), ''), 'upcoming');
      if v_year_name is null or v_name is null then
        raise exception 'Academic Year and Name are required.';
      end if;

      select id into v_year_id from academic_years where school_id = v_school_id and lower(name) = lower(v_year_name);
      if v_year_id is null then
        raise exception 'No Academic Year found matching "%" -- import Academic Years first.', v_year_name;
      end if;

      begin
        v_term_number := nullif(trim(both from (v_row->>'term_number')), '')::int;
      exception when others then
        raise exception 'Term No. must be a whole number.';
      end;
      if v_term_number is null or v_term_number not between 1 and 3 then
        raise exception 'Term No. must be 1, 2, or 3 (got "%").', coalesce(v_row->>'term_number', '(blank)');
      end if;

      begin
        v_start := nullif(trim(both from (v_row->>'start_date')), '')::date;
        v_end := nullif(trim(both from (v_row->>'end_date')), '')::date;
      exception when others then
        raise exception 'Start Date and End Date must be valid dates (YYYY-MM-DD).';
      end;
      if v_start is null or v_end is null then
        raise exception 'Start Date and End Date are required.';
      end if;
      if v_status not in ('upcoming', 'active', 'closed') then
        raise exception 'Status must be one of upcoming, active, closed (got "%").', v_status;
      end if;

      insert into terms (school_id, academic_year_id, name, term_number, start_date, end_date, status)
      values (v_school_id, v_year_id, v_name, v_term_number, v_start, v_end, v_status)
      on conflict (academic_year_id, term_number)
      do update set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, status = excluded.status;

      row_number := v_idx; status := 'ok'; message := format('%s / %s imported.', v_year_name, v_name);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_terms(jsonb) from public, anon;
grant execute on function public.bulk_import_terms(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Classes. Row keys: academic_year_name, name, level_order (optional,
-- default 0). Upserts on (academic_year_id, name).
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_classes(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_year_name text;
  v_year_id uuid;
  v_name text;
  v_level_order int;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_year_name := nullif(trim(both from (v_row->>'academic_year_name')), '');
      v_name := nullif(trim(both from (v_row->>'name')), '');
      if v_year_name is null or v_name is null then
        raise exception 'Academic Year and Name are required.';
      end if;

      select id into v_year_id from academic_years where school_id = v_school_id and lower(name) = lower(v_year_name);
      if v_year_id is null then
        raise exception 'No Academic Year found matching "%" -- import Academic Years first.', v_year_name;
      end if;

      begin
        v_level_order := coalesce(nullif(trim(both from (v_row->>'level_order')), ''), '0')::int;
      exception when others then
        raise exception 'Level Order must be a whole number.';
      end;

      insert into classes (school_id, academic_year_id, name, level_order)
      values (v_school_id, v_year_id, v_name, v_level_order)
      on conflict (academic_year_id, name)
      do update set level_order = excluded.level_order;

      row_number := v_idx; status := 'ok'; message := format('%s imported.', v_name);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_classes(jsonb) from public, anon;
grant execute on function public.bulk_import_classes(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Streams. Row keys: academic_year_name, class_name, stream_name, capacity
-- (optional). Upserts on (class_id, name).
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_streams(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_year_name text;
  v_class_name text;
  v_stream_name text;
  v_class_id uuid;
  v_capacity int;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_year_name := nullif(trim(both from (v_row->>'academic_year_name')), '');
      v_class_name := nullif(trim(both from (v_row->>'class_name')), '');
      v_stream_name := nullif(trim(both from (v_row->>'stream_name')), '');
      if v_year_name is null or v_class_name is null or v_stream_name is null then
        raise exception 'Academic Year, Class, and Stream Name are required.';
      end if;

      select c.id into v_class_id
        from classes c
        join academic_years ay on ay.id = c.academic_year_id
        where ay.school_id = v_school_id and lower(ay.name) = lower(v_year_name) and lower(c.name) = lower(v_class_name);
      if v_class_id is null then
        raise exception 'No Class found matching Academic Year "%" / Class "%" -- import Classes first.', v_year_name, v_class_name;
      end if;

      begin
        v_capacity := nullif(trim(both from (v_row->>'capacity')), '')::int;
      exception when others then
        raise exception 'Capacity must be a whole number.';
      end;

      insert into streams (school_id, class_id, name, capacity)
      values (v_school_id, v_class_id, v_stream_name, v_capacity)
      on conflict (class_id, name)
      do update set capacity = excluded.capacity;

      row_number := v_idx; status := 'ok'; message := format('%s / %s imported.', v_class_name, v_stream_name);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_streams(jsonb) from public, anon;
grant execute on function public.bulk_import_streams(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Subjects. Row key: name (must match an existing public.subject_catalogue
-- entry, case-insensitive -- schools activate a subject from the shared CBC
-- catalogue, they don't free-type their own; see the subject_catalogue
-- migration). "is_active" is optional (default true). Idempotent: activating
-- an already-active subject is a no-op; reactivates a previously-deactivated
-- one instead of erroring, matching activateSubjects() in academics/actions.ts.
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_subjects(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_name text;
  v_is_active boolean;
  v_catalogue record;
  v_existing_id uuid;
  v_existing_active boolean;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_name := nullif(trim(both from (v_row->>'name')), '');
      if v_name is null then
        raise exception 'Name is required.';
      end if;
      v_is_active := coalesce(nullif(lower(trim(both from (v_row->>'is_active'))), '')::boolean, true);

      select id, name, code, is_core into v_catalogue from subject_catalogue where lower(name) = lower(v_name);
      if v_catalogue.id is null then
        raise exception 'No subject in the CBC catalogue matches "%" -- check spelling against the master subject list.', v_name;
      end if;

      select id, is_active into v_existing_id, v_existing_active
        from subjects where school_id = v_school_id and catalogue_id = v_catalogue.id;

      if v_existing_id is not null then
        update subjects set is_active = v_is_active where id = v_existing_id;
      else
        insert into subjects (school_id, catalogue_id, name, code, is_core, is_active)
        values (v_school_id, v_catalogue.id, v_catalogue.name, v_catalogue.code, v_catalogue.is_core, v_is_active);
      end if;

      row_number := v_idx; status := 'ok'; message := format('%s imported.', v_catalogue.name);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_subjects(jsonb) from public, anon;
grant execute on function public.bulk_import_subjects(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Students. Row keys: admission_number, upi_number (optional), first_name,
-- last_name, other_names (optional), date_of_birth, gender, class_name
-- (optional), stream_name (optional), status (optional, default 'active'),
-- admission_date (optional, default today). Upserts on
-- (school_id, admission_number).
--
-- A student's status can only be 'active'/'enrolled' once they have a
-- primary-contact guardian (enforce_student_has_primary_guardian trigger) --
-- which, on a first import, they never do yet, since Guardians import runs
-- after Students. Rather than force every migrating school to re-run this
-- twice, a row requesting 'active'/'enrolled' status is inserted as 'applied'
-- instead, with a note telling the caller it'll need finalizing; import
-- Guardians for that admission number and the status can then be set
-- normally from Students > (student) > edit, same as any other student.
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_students(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_adm text;
  v_upi text;
  v_first text;
  v_last text;
  v_other text;
  v_dob date;
  v_gender text;
  v_class_name text;
  v_stream_name text;
  v_stream_id uuid;
  v_req_status text;
  v_insert_status text;
  v_adm_date date;
  v_deferred boolean;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_deferred := false;
    begin
      v_adm := nullif(trim(both from (v_row->>'admission_number')), '');
      v_first := nullif(trim(both from (v_row->>'first_name')), '');
      v_last := nullif(trim(both from (v_row->>'last_name')), '');
      v_other := nullif(trim(both from (v_row->>'other_names')), '');
      v_upi := nullif(trim(both from (v_row->>'upi_number')), '');
      v_gender := lower(nullif(trim(both from (v_row->>'gender')), ''));
      v_class_name := nullif(trim(both from (v_row->>'class_name')), '');
      v_stream_name := nullif(trim(both from (v_row->>'stream_name')), '');
      v_req_status := coalesce(nullif(lower(trim(both from (v_row->>'status'))), ''), 'active');

      if v_adm is null or v_first is null or v_last is null then
        raise exception 'Admission No., First Name, and Last Name are required.';
      end if;
      if v_gender not in ('male', 'female') then
        raise exception 'Gender must be male or female (got "%").', coalesce(v_row->>'gender', '(blank)');
      end if;
      if v_req_status not in ('applied','approved','enrolled','active','withdrawn','transferred','graduated') then
        raise exception 'Unrecognized status "%".', v_req_status;
      end if;

      begin
        v_dob := nullif(trim(both from (v_row->>'date_of_birth')), '')::date;
      exception when others then
        raise exception 'DOB must be a valid date (YYYY-MM-DD).';
      end;
      if v_dob is null then
        raise exception 'DOB is required.';
      end if;

      begin
        v_adm_date := coalesce(nullif(trim(both from (v_row->>'admission_date')), '')::date, current_date);
      exception when others then
        raise exception 'Admission Date must be a valid date (YYYY-MM-DD).';
      end;

      v_stream_id := null;
      if v_class_name is not null and v_stream_name is not null then
        select str.id into v_stream_id
          from streams str
          join classes c on c.id = str.class_id
          where c.school_id = v_school_id and lower(c.name) = lower(v_class_name) and lower(str.name) = lower(v_stream_name);
        if v_stream_id is null then
          raise exception 'No stream found matching Class "%" / Stream "%" -- import Classes/Streams first, or leave blank.', v_class_name, v_stream_name;
        end if;
      end if;

      v_insert_status := v_req_status;
      if v_req_status in ('active', 'enrolled') then
        v_insert_status := 'applied'; -- see function comment; finalized once a guardian is linked
        v_deferred := true;
      end if;

      insert into students (school_id, admission_number, upi_number, first_name, last_name, other_names, date_of_birth, gender, current_class_id, status, admission_date)
      values (v_school_id, v_adm, v_upi, v_first, v_last, v_other, v_dob, v_gender, v_stream_id, v_insert_status, v_adm_date)
      on conflict (school_id, admission_number)
      do update set upi_number = excluded.upi_number, first_name = excluded.first_name, last_name = excluded.last_name,
        other_names = excluded.other_names, date_of_birth = excluded.date_of_birth, gender = excluded.gender,
        current_class_id = excluded.current_class_id, admission_date = excluded.admission_date;
      -- status intentionally left off the update clause: re-uploading the same
      -- file must not clobber a status the school has since changed in-app.

      row_number := v_idx;
      status := 'ok';
      if v_deferred then
        message := format('%s %s imported as Applied -- import a Guardian for %s, then set status to %s.', v_first, v_last, v_adm, initcap(v_req_status));
      else
        message := format('%s %s imported.', v_first, v_last);
      end if;
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_students(jsonb) from public, anon;
grant execute on function public.bulk_import_students(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Guardians. Row keys: student_admission_number, guardian_full_name,
-- guardian_phone, guardian_email (optional), relationship, primary_contact
-- (optional, default false, accepts "Yes"/"No"/true/false). Finds-or-creates
-- the guardian school_users row by normalized Kenyan phone number, exactly
-- like findOrCreateGuardian() (lib/guardians.ts) does for the one-at-a-time
-- "Add guardian" flow -- so a guardian who already exists (e.g. already
-- linked to a sibling) is reused, not duplicated.
-- ----------------------------------------------------------------------------
create or replace function public.bulk_import_guardians(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_adm text;
  v_student_id uuid;
  v_full_name text;
  v_phone_raw text;
  v_phone text;
  v_digits text;
  v_email text;
  v_relationship text;
  v_primary_raw text;
  v_primary boolean;
  v_parent_role_id uuid;
  v_guardian_id uuid;
  v_guardian_role_name text;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  select id into v_parent_role_id from roles where name = 'parent';

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_adm := nullif(trim(both from (v_row->>'student_admission_number')), '');
      v_full_name := nullif(trim(both from (v_row->>'guardian_full_name')), '');
      v_phone_raw := trim(both from (v_row->>'guardian_phone'));
      v_email := nullif(trim(both from (v_row->>'guardian_email')), '');
      v_relationship := lower(nullif(trim(both from (v_row->>'relationship')), ''));
      v_primary_raw := lower(nullif(trim(both from (v_row->>'primary_contact')), ''));
      v_primary := v_primary_raw in ('yes', 'true', '1');

      if v_adm is null or v_full_name is null then
        raise exception 'Student Adm. No. and Guardian Name are required.';
      end if;
      if v_relationship not in ('mother', 'father', 'guardian', 'other') then
        raise exception 'Relationship must be one of mother, father, guardian, other (got "%").', coalesce(v_row->>'relationship', '(blank)');
      end if;

      select id into v_student_id from students where school_id = v_school_id and lower(admission_number) = lower(v_adm);
      if v_student_id is null then
        raise exception 'No student found matching Adm. No. "%" -- import Students first.', v_adm;
      end if;

      -- Normalize to +254XXXXXXXXX, same rules as normalizeKenyanPhone() in lib/guardians.ts.
      v_digits := regexp_replace(coalesce(v_phone_raw, ''), '[\s\-()]', '', 'g');
      v_phone := case
        when v_digits ~ '^\+254\d{9}$' then v_digits
        when v_digits ~ '^0[17]\d{8}$' then '+254' || substr(v_digits, 2)
        when v_digits ~ '^254[17]\d{8}$' then '+' || v_digits
        when v_digits ~ '^[17]\d{8}$' then '+254' || v_digits
        else null
      end;
      if v_phone is null then
        raise exception 'Guardian Phone must be a valid Kenyan mobile number, e.g. 0712345678 (got "%").', coalesce(v_phone_raw, '(blank)');
      end if;

      select su.id, r.name into v_guardian_id, v_guardian_role_name
        from school_users su join roles r on r.id = su.role_id
        where su.phone = v_phone
        limit 1;

      if v_guardian_id is not null and v_guardian_role_name <> 'parent' then
        raise exception 'Phone number % is already registered under a different role.', v_phone;
      end if;

      if v_guardian_id is null then
        insert into school_users (school_id, role_id, full_name, phone, email)
        values (v_school_id, v_parent_role_id, v_full_name, v_phone, v_email)
        returning id into v_guardian_id;
      end if;

      insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact)
      values (v_student_id, v_guardian_id, v_relationship, v_primary)
      on conflict (student_id, guardian_user_id)
      do update set relationship = excluded.relationship, primary_contact = excluded.primary_contact;

      row_number := v_idx; status := 'ok'; message := format('%s linked to %s.', v_full_name, v_adm);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_guardians(jsonb) from public, anon;
grant execute on function public.bulk_import_guardians(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Audit log entry for a completed import run, mirroring
-- log_school_data_export() (SD-09). Called once by the TS orchestrator after
-- every sheet in the uploaded file has been processed, not once per RPC, so
-- one import run leaves one audit_log row summarizing the whole batch.
-- ----------------------------------------------------------------------------
create or replace function public.log_school_data_import(p_dataset_names text[], p_row_counts jsonb)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_user_id uuid;
  v_school_id uuid;
begin
  if not auth_has_permission('settings.data_import') then
    raise exception 'not authorized to import school data';
  end if;

  select su.id, su.school_id into v_school_user_id, v_school_id
  from school_users su
  where su.auth_user_id = auth.uid()
    and su.status = 'active'
  limit 1;

  if v_school_id is null then
    raise exception 'no active school context for caller';
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (
    v_school_id,
    v_school_user_id,
    'school_data_import',
    v_school_id,
    'import',
    'School data import (' || array_length(p_dataset_names, 1) || ' datasets)',
    jsonb_build_object('datasets', p_dataset_names, 'row_counts', p_row_counts)
  );
end;
$$;
grant execute on function public.log_school_data_import(text[], jsonb) to authenticated;
