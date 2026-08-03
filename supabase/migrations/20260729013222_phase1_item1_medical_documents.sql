-- ============================================================
-- medical_records: one evolving record per student (not a log --
-- the UI spec shows a single Medical tab, not a history view).
-- ============================================================
create table medical_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references students(id) on delete cascade,
  blood_group text,
  conditions text,
  allergies text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  updated_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_medical_records_updated_at
  before update on medical_records
  for each row execute function set_updated_at();

-- ============================================================
-- document_access_log: insert-only audit trail. Every time a medical
-- record or sensitive document is opened, who and when (Part H/L).
-- No UPDATE/DELETE grants for any application role, including staff --
-- an audit trail editable by the roles it holds accountable isn't one.
-- ============================================================
create table document_access_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  accessed_by uuid not null references school_users(id),
  resource_type text not null check (resource_type in ('medical_record', 'document')),
  resource_id uuid not null,
  student_id uuid references students(id) on delete cascade,
  accessed_at timestamptz not null default now()
);

create index idx_document_access_log_school_id on document_access_log(school_id, accessed_at desc);
create index idx_document_access_log_student_id on document_access_log(student_id);

-- ============================================================
-- documents: metadata only -- actual files live in Storage, referenced
-- by storage_path. Signed URLs generated server-side at read time,
-- never a public bucket link (Part I).
-- ============================================================
create table documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  category text not null check (category in ('birth_certificate', 'id_scan', 'report_card', 'transfer_letter', 'other')),
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid not null references school_users(id),
  created_at timestamptz not null default now()
);

create index idx_documents_student_id on documents(student_id);
create index idx_documents_school_id on documents(school_id);

-- Logs a medical-record view. Called explicitly by the app right after
-- the "I need to view this" soft-reconfirmation click (§S.4) -- this is
-- the actual trigger point for the audit entry, since Postgres has no
-- SELECT-trigger mechanism to hook this at the DB layer alone. RLS on
-- medical_records (below) is the real access control; this function
-- only records that a permitted read happened.
create or replace function log_medical_record_access(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_school_user_id uuid;
  v_caller_school_id uuid;
  v_medical_record_id uuid;
begin
  select id, school_id into v_caller_school_user_id, v_caller_school_id
  from school_users where auth_user_id = auth.uid() and status = 'active';

  select id into v_medical_record_id from medical_records where student_id = p_student_id;

  if v_medical_record_id is null then
    return;
  end if;

  insert into document_access_log (school_id, accessed_by, resource_type, resource_id, student_id)
  values (v_caller_school_id, v_caller_school_user_id, 'medical_record', v_medical_record_id, p_student_id);
end;
$$;

revoke execute on function log_medical_record_access(uuid) from public, anon;
grant execute on function log_medical_record_access(uuid) to authenticated;
