-- Phase 10: Admissions as a genuinely separate entity from Students.
-- Flagged as an open architectural question back in Phase 1: today's apply
-- flow inserts directly into `students`, so a rejected/waitlisted applicant
-- already has a permanent student record forever. Brief §4.16.2 is explicit
-- that this must not happen. This migration adds the `applications` table
-- and wires the full pre-enrollment lifecycle onto it; Students stays
-- untouched until a real enrollment happens (Phase 11/12, not this phase).

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_number text not null,

  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'under_review', 'documents_required', 'shortlisted',
    'interview_scheduled', 'assessment_required', 'accepted', 'conditionally_accepted',
    'waitlisted', 'rejected', 'withdrawn', 'admission_pending', 'enrolled'
  )),
  application_source text not null default 'online' check (application_source in ('online', 'walk_in')),
  admission_type text not null default 'new' check (admission_type in ('new', 'transfer', 're_admission')),

  -- Student fields (Brief 4.16.3) — this is the applicant's data, kept
  -- entirely separate from the students table until enrollment.
  first_name text not null,
  last_name text not null,
  other_names text,
  date_of_birth date not null,
  gender text not null check (gender in ('male', 'female')),
  nationality text,
  id_number text,
  previous_school text,
  previous_class text,
  special_needs_info text,

  -- Guardian — reuses the existing school_users identity (find-or-create),
  -- never a separate applicant-guardian record.
  guardian_id uuid references public.school_users(id),

  -- Application details
  academic_year_id uuid references public.academic_years(id),
  term_id uuid references public.terms(id),
  intended_class_id uuid references public.streams(id),
  boarding_preference text check (boarding_preference in ('day', 'boarding')),
  transport_required boolean not null default false,

  -- Interview / assessment (Brief 4.16.5) — belongs to the application, not
  -- pushed into permanent student academic history.
  interview_date timestamptz,
  interviewer_id uuid references public.school_users(id),
  assessment_date date,
  assessment_type text,
  assessment_subject text,
  assessment_score numeric,
  assessment_comments text,
  recommendation text,

  -- Decision (Brief 4.16.6)
  decision_by uuid references public.school_users(id),
  decision_at timestamptz,
  decision_notes text,

  -- Traceability (Brief 4.16.7): Application -> Admission -> Student,
  -- without duplicate person records. Set only when Phase 11/12's wizard
  -- actually completes enrollment — null for the whole of Phase 10.
  resulting_student_id uuid references public.students(id),

  assigned_officer_id uuid references public.school_users(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (school_id, application_number)
);

create index idx_applications_school_status on public.applications(school_id, status);
create index idx_applications_guardian on public.applications(guardian_id);

comment on table public.applications is 'Pre-enrollment lifecycle only (Brief 4.16.2). Rejected/waitlisted/withdrawn applications stay here forever and never touch students. resulting_student_id is the only link to students, set once by the onboarding wizard (Phase 11/12).';

-- Application number generator: APP-{year}-{sequence, per school per year}.
create sequence if not exists public.application_number_seq;

create or replace function public.generate_application_number(p_school_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_next int;
begin
  select coalesce(max(substring(application_number from '\d+$')::int), 0) + 1
    into v_next
    from public.applications
    where school_id = p_school_id and application_number like 'APP-' || v_year || '-%';
  return 'APP-' || v_year || '-' || lpad(v_next::text, 5, '0');
end;
$$;

alter table public.applications enable row level security;

create policy applications_select on public.applications
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('admissions.read_any'))
    or (guardian_id is not null and guardian_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active'))
  );

create policy applications_write on public.applications
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('admissions.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('admissions.write'))
  );

-- School-configurable document checklist (Brief 4.16.3 "configurable... requirements").
create table public.application_document_requirements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  category text not null,
  label text not null,
  required boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, category)
);

alter table public.application_document_requirements enable row level security;

create policy application_document_requirements_select on public.application_document_requirements
  for select using (auth_is_super_admin() or school_id = auth_school_id());

create policy application_document_requirements_write on public.application_document_requirements
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('admissions.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('admissions.write'))
  );

-- Default checklist per Brief 4.16.3, seeded for existing schools (schools can edit/add later).
insert into public.application_document_requirements (school_id, category, label, required, display_order)
select s.id, v.category, v.label, true, v.ord
from public.schools s
cross join (values
  ('birth_certificate', 'Birth Certificate', 1),
  ('previous_report', 'Previous School Report', 2),
  ('guardian_id', 'Guardian ID', 3),
  ('transfer_letter', 'Transfer Letter', 4),
  ('passport_photo', 'Passport Photo', 5)
) as v(category, label, ord)
where not exists (
  select 1 from public.application_document_requirements r where r.school_id = s.id and r.category = v.category
);

-- Extend the existing Documents table with a third owner type (application),
-- rather than a parallel storage system (Brief 4.16.4: "reuse the existing
-- document/storage system — do not build a second one").
alter table public.documents
  add column if not exists application_id uuid references public.applications(id) on delete cascade,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_comment text,
  add column if not exists verified_by uuid references public.school_users(id),
  add column if not exists verified_at timestamptz;

alter table public.documents
  add constraint documents_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected'));

alter table public.documents drop constraint documents_one_owner_check;
alter table public.documents add constraint documents_one_owner_check
  check (
    (student_id is not null)::int + (staff_id is not null)::int + (application_id is not null)::int = 1
  );

create index idx_documents_application_id on public.documents(application_id);

drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.read'))
    or (student_id is not null and auth_user_id_is_guardian_of(student_id))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.read'))
    or (staff_id is not null and staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active'))
    or (school_id = auth_school_id() and application_id is not null and auth_has_permission('admissions.read_any'))
    or (application_id is not null and application_id in (
      select id from public.applications where guardian_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
    ))
  );

drop policy documents_write on public.documents;
create policy documents_write on public.documents
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.write'))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.manage'))
    or (school_id = auth_school_id() and application_id is not null and auth_has_permission('admissions.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.write'))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.manage'))
    or (school_id = auth_school_id() and application_id is not null and auth_has_permission('admissions.write'))
  );

-- Permission keys, granted to the same roles that already hold students.write
-- (the effective set of people who do admissions work today doesn't change).
insert into public.role_permissions (role_id, permission_key)
select r.id, perm
from public.roles r
cross join (values ('admissions.read_any'), ('admissions.write')) as p(perm)
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;

-- Storage bucket for application documents (public applicant uploads go
-- through a service-role server action, same pattern as the existing public
-- apply flow — no direct public bucket writes). Staff reads gated by RLS.
insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false)
on conflict (id) do nothing;

create policy application_documents_select on storage.objects
  for select using (
    bucket_id = 'application-documents'
    and (
      auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('admissions.read_any'))
    )
  );

create policy application_documents_staff_write on storage.objects
  for insert with check (
    bucket_id = 'application-documents'
    and auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('admissions.write'))
  );
