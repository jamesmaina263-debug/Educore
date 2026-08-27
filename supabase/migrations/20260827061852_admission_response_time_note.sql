alter table public.schools
  add column if not exists admission_response_note text;

comment on column public.schools.admission_response_note is
  'Optional, school-configurable line shown on the application confirmation SMS and the parent status page, e.g. "Typical response time: 5 business days." Null means nothing is shown.';
