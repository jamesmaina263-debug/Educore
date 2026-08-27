-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Captures the live end-state: per-school
-- admission-form-template storage + the queue_admission_form_email() RPC used to send the
-- filled form on acceptance. All statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE
-- / ON CONFLICT DO NOTHING) so replaying against a database that already has these objects
-- is a safe no-op.

CREATE TABLE IF NOT EXISTS public.admission_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL UNIQUE REFERENCES public.schools(id),
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  uploaded_by uuid REFERENCES public.school_users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admission_form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_form_templates_select ON public.admission_form_templates;
CREATE POLICY admission_form_templates_select ON public.admission_form_templates
  FOR SELECT
  USING (
    school_id = auth_school_id()
    AND (auth_has_permission('settings.branding.write') OR auth_has_permission('admissions.write'))
  );

DROP POLICY IF EXISTS admission_form_templates_write ON public.admission_form_templates;
CREATE POLICY admission_form_templates_write ON public.admission_form_templates
  FOR INSERT
  WITH CHECK (school_id = auth_school_id() AND auth_has_permission('settings.branding.write'));

DROP POLICY IF EXISTS admission_form_templates_delete ON public.admission_form_templates;
CREATE POLICY admission_form_templates_delete ON public.admission_form_templates
  FOR DELETE
  USING (school_id = auth_school_id() AND auth_has_permission('settings.branding.write'));

-- Storage bucket for the uploaded .docx templates themselves (one per school, replace-on-upload).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'admission-form-templates', 'admission-form-templates', false, 5242880,
  ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS admission_form_templates_bucket_select ON storage.objects;
CREATE POLICY admission_form_templates_bucket_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'admission-form-templates'
    AND (
      auth_is_super_admin()
      OR (
        ((storage.foldername(name))[1])::uuid = auth_school_id()
        AND (auth_has_permission('settings.branding.write') OR auth_has_permission('admissions.write'))
      )
    )
  );

DROP POLICY IF EXISTS admission_form_templates_bucket_write ON storage.objects;
CREATE POLICY admission_form_templates_bucket_write ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'admission-form-templates'
    AND (
      auth_is_super_admin()
      OR (
        ((storage.foldername(name))[1])::uuid = auth_school_id()
        AND auth_has_permission('settings.branding.write')
      )
    )
  );

DROP POLICY IF EXISTS admission_form_templates_bucket_delete ON storage.objects;
CREATE POLICY admission_form_templates_bucket_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'admission-form-templates'
    AND (
      auth_is_super_admin()
      OR (
        ((storage.foldername(name))[1])::uuid = auth_school_id()
        AND auth_has_permission('settings.branding.write')
      )
    )
  );

-- Queues the filled-in acceptance email (with the merged .docx as an attachment) into
-- notification_logs. Gated on admissions.write rather than the broader communication.write,
-- matching queue_health_alert's precedent.
CREATE OR REPLACE FUNCTION public.queue_admission_form_email(
  p_application_id uuid,
  p_subject text,
  p_body text,
  p_attachment_storage_path text DEFAULT NULL::text,
  p_attachment_filename text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_email text;
  v_log_id uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized.';
  end if;

  select su.email into v_email
  from public.applications app
  join public.school_users su on su.id = app.guardian_id
  where app.id = p_application_id and app.school_id = v_school_id;

  if not found or v_email is null then
    return null;
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

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
