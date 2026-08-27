-- Infrastructure for: each school uploads its own admission-form template (their own
-- letterhead/wording/layout, since this is multi-tenant and formats differ per school); the
-- system fills placeholders in with the specific applicant's details and the resolved fee
-- structure, then queues it as an email attachment when an online application is accepted.
-- No admission_number placeholder -- that's only assigned when the student is later formally
-- enrolled (see defer_admission_number_to_enrollment), not known yet at acceptance.

-- 1. Attachment support for the notification/email pipeline (single attachment is enough for
-- this use case; kept minimal rather than a jsonb array pending a real second use case).
alter table public.notification_logs add column attachment_storage_path text;
alter table public.notification_logs add column attachment_filename text;
comment on column public.notification_logs.attachment_storage_path is
  'Path within the application-documents bucket, if this email carries an attachment. Only meaningful for channel=email.';

-- 2. The uploaded template itself: one per school, storage_path convention
-- {school_id}/template.docx (re-upload replaces via delete+insert, matching the existing
-- document-upload convention elsewhere in this codebase).
create table public.admission_form_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) unique,
  storage_path text not null,
  original_filename text not null,
  uploaded_by uuid references public.school_users(id),
  uploaded_at timestamptz not null default now()
);

alter table public.admission_form_templates enable row level security;

-- Read: either whoever manages school branding, or whoever processes admissions (they need to
-- know a template exists / read it to generate a filled copy) -- two legitimate reasons to see
-- the same row, only the former can replace it.
create policy admission_form_templates_select on public.admission_form_templates
  for select using (
    school_id = auth_school_id()
    and (auth_has_permission('settings.branding.write') or auth_has_permission('admissions.write'))
  );
create policy admission_form_templates_write on public.admission_form_templates
  for insert with check (school_id = auth_school_id() and auth_has_permission('settings.branding.write'));
create policy admission_form_templates_delete on public.admission_form_templates
  for delete using (school_id = auth_school_id() and auth_has_permission('settings.branding.write'));

-- 3. Storage bucket for the uploaded templates themselves (docx only -- editable placeholder
-- fields, not a flat image/PDF a school can't put merge fields into).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admission-form-templates', 'admission-form-templates', false, 5242880,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
);

create policy admission_form_templates_bucket_select on storage.objects
  for select using (
    bucket_id = 'admission-form-templates'
    and (auth_is_super_admin() or (
      ((storage.foldername(name))[1])::uuid = auth_school_id()
      and (auth_has_permission('settings.branding.write') or auth_has_permission('admissions.write'))
    ))
  );
create policy admission_form_templates_bucket_write on storage.objects
  for insert with check (
    bucket_id = 'admission-form-templates'
    and (auth_is_super_admin() or (
      ((storage.foldername(name))[1])::uuid = auth_school_id()
      and auth_has_permission('settings.branding.write')
    ))
  );
create policy admission_form_templates_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'admission-form-templates'
    and (auth_is_super_admin() or (
      ((storage.foldername(name))[1])::uuid = auth_school_id()
      and auth_has_permission('settings.branding.write')
    ))
  );

-- 4. Fee-structure preview keyed off (term, class) directly rather than a student -- at
-- acceptance time there's no student record yet (that's only created later, in the wizard).
-- Mirrors create_or_get_invoice_for_student's own core+transport resolution logic exactly, but
-- read-only and gated on admissions.write (the real authorization boundary for this call site)
-- rather than finance.write, since no invoice is created here.
create or replace function public.preview_fee_structure_for_class(
  p_school_id uuid, p_term_id uuid, p_class_id uuid, p_is_boarder boolean, p_needs_transport boolean
)
returns table(item_name text, amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_structure_id uuid;
  v_transport_structure_id uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized.';
  end if;
  if p_school_id <> auth_school_id() then
    raise exception 'Not authorized.';
  end if;

  select id into v_structure_id from fee_structures
    where school_id = p_school_id and term_id = p_term_id and class_id = p_class_id
      and fee_category = 'core' and boarding_type = (case when p_is_boarder then 'boarder' else 'day' end) and is_active
    limit 1;
  if v_structure_id is null then
    select id into v_structure_id from fee_structures
      where school_id = p_school_id and term_id = p_term_id and class_id is null
        and fee_category = 'core' and boarding_type = (case when p_is_boarder then 'boarder' else 'day' end) and is_active
      limit 1;
  end if;
  if v_structure_id is null then
    return;
  end if;

  return query select fi.name, fi.amount from fee_items fi where fi.fee_structure_id = v_structure_id;

  if p_needs_transport then
    select id into v_transport_structure_id from fee_structures
      where school_id = p_school_id and term_id = p_term_id and class_id = p_class_id
        and fee_category = 'transport' and is_active
      limit 1;
    if v_transport_structure_id is null then
      select id into v_transport_structure_id from fee_structures
        where school_id = p_school_id and term_id = p_term_id and class_id is null
          and fee_category = 'transport' and is_active
        limit 1;
    end if;
    if v_transport_structure_id is not null then
      return query select fi.name, fi.amount from fee_items fi where fi.fee_structure_id = v_transport_structure_id;
    end if;
  end if;
end;
$function$;
revoke execute on function public.preview_fee_structure_for_class(uuid,uuid,uuid,boolean,boolean) from public, anon;
grant execute on function public.preview_fee_structure_for_class(uuid,uuid,uuid,boolean,boolean) to authenticated;

-- 5. Queues the acceptance email directly into notification_logs, bypassing the general
-- queue_communication() gate (which requires communication.write -- a permission an admissions
-- officer accepting an application has no reason to hold). admissions.write is the real
-- authorization boundary for this specific, narrow action, matching queue_health_alert's
-- identical precedent for health.write. Dispatch (the actual send) still happens later via the
-- same shared send-communication mechanism as every other queued message in this system -- not
-- instant, same as everything else here.
create or replace function public.queue_admission_form_email(
  p_application_id uuid, p_subject text, p_body text,
  p_attachment_storage_path text default null, p_attachment_filename text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_app record;
  v_email text;
  v_log_id uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized.';
  end if;

  select a.student_id, a.email, a.first_name || ' ' || a.last_name as guardian_name
    into v_app
  from public.applications app
  join public.school_users a on a.id = app.guardian_id
  where app.id = p_application_id and app.school_id = v_school_id;

  if not found then
    return null;
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();
  v_email := v_app.email;

  if v_email is null then
    return null;
  end if;

  insert into public.notification_logs (
    school_id, recipient_email, recipient_type, channel, subject, body, status, segments, sent_by,
    source_module, attachment_storage_path, attachment_filename
  ) values (
    v_school_id, v_email, 'guardian', 'email', p_subject, p_body, 'queued', 1, v_sender,
    'admissions', p_attachment_storage_path, p_attachment_filename
  ) returning id into v_log_id;

  return v_log_id;
end;
$function$;
revoke execute on function public.queue_admission_form_email(uuid,text,text,text,text) from public, anon;
grant execute on function public.queue_admission_form_email(uuid,text,text,text,text) to authenticated;
