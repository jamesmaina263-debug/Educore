-- One-time welcome email for newly registered schools (step 1 of 2: the database half).
--
-- Why: a new school gets the set-password email from Supabase Auth, and we want a second, separate welcome email
-- with the WhatsApp support link. It must be sent exactly once per school, never on sign-in, and never again if
-- the signup workflow is retried or replayed. This column is the send-once marker.
--
-- How it is used (step 2, the send-school-welcome Edge Function): the function claims the send with a single
-- atomic `update ... where welcome_email_sent_at is null returning id`, sends the email, and clears the marker
-- again only if the provider refused the message, so a failed send can be retried and a duplicate cannot happen.
--
-- Existing schools are backfilled below, so no school that is already on the platform (including live tenants)
-- can ever receive a "new school" welcome email. Only schools created after this migration start with NULL.
--
-- Additive and safe to run twice: `add column if not exists`, and the backfill only touches rows that are still NULL.

alter table public.schools
  add column if not exists welcome_email_sent_at timestamptz;

comment on column public.schools.welcome_email_sent_at is
  'When the one-time welcome email was claimed/sent for this school. NULL = not sent yet. Set atomically by the send-school-welcome Edge Function; schools that existed before the welcome email shipped are backfilled so they never receive it.';

-- Backfill every school that already exists: they are not "new", so they must not get a welcome email.
update public.schools
   set welcome_email_sent_at = coalesce(created_at, now())
 where welcome_email_sent_at is null;
