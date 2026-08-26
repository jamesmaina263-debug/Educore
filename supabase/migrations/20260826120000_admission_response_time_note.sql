-- Task 13 of the admissions fix backlog: parents get no expected-response-time messaging
-- while an application is being reviewed, which drives repeat calls to the front office.
--
-- Adds one nullable, per-school-configurable text field on the existing `schools` table
-- (no new table -- this is a single settings string, same tier as motto/kra_pin already on
-- this table). Purely additive: existing rows default to null, which both the confirmation
-- SMS and the parent status page already treat as "don't show this line."
alter table public.schools
  add column if not exists admission_response_note text;

comment on column public.schools.admission_response_note is
  'Optional, school-configurable line shown on the application confirmation SMS and the parent status page, e.g. "Typical response time: 5 business days." Null means nothing is shown.';
