-- Clickable WhatsApp link in the two automatic onboarding emails.
--
-- Many school owners find it hard to copy a phone number into WhatsApp, so the emails now carry a
-- "Click here to chat with us on WhatsApp" link that opens the chat directly. The owner approved allowing this link.
--
-- Safeguard change (the only one): _trial_nudge_content_problem still refuses every link and address outside
-- educoreafrica.com, with ONE exception: the exact link https://wa.me/254702904562 (EduCore support). It is removed
-- from the text before the domain scan; any other wa.me number, or a longer number that merely starts with this one,
-- is still refused. Every other rule in the function is unchanged, copied from the live definition.
--
-- Templates: only the WhatsApp line of the two onboarding_email_templates rows changes. Changing a template makes any
-- earlier approval stop matching (onboarding_settings.templates_approved_hash), so a super admin approves the new
-- wording on /admin/onboarding before anything is sent. Nothing is sent by this migration. Safe to run twice.
-- The function keeps its existing privileges (CREATE OR REPLACE preserves them).

create or replace function public._trial_nudge_content_problem(p_kind text, p_subject text, p_body text)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  v text := lower(coalesce(p_subject, '') || E'\n' || coalesce(p_body, ''));
  v_scan text;
  phrase text;
  dom text[];
begin
  if p_kind is null or p_kind not in ('service', 'promotional') then
    return 'Choose service or promotional.';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 then return 'Subject is required.'; end if;
  if char_length(btrim(p_subject)) > 200 then return 'Subject is too long (max 200 characters).'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then return 'Message is required.'; end if;
  if char_length(btrim(p_body)) > 4000 then return 'Message is too long (max 4000 characters).'; end if;

  -- Claims the product must not make.
  foreach phrase in array array[
    'no obligation', 'kicd approved', 'kicd-approved', 'approved by kicd', 'ministry approved',
    'ministry-approved', 'approved by the ministry', 'guaranteed', 'free forever'
  ] loop
    if position(phrase in v) > 0 then
      return 'Remove "' || phrase || '": EduCore does not make that claim.';
    end if;
  end loop;

  -- Only {{name}} and {{school}} are filled in at send time; anything else would go out as literal text.
  if regexp_replace(v, '\{\{\s*(name|school)\s*\}\}', '', 'g') ~ '(\{\{|\}\})' then
    return 'Only {{name}} and {{school}} can be used as placeholders.';
  end if;

  -- Links and addresses may only point at educoreafrica.com, plus EduCore's own WhatsApp support link.
  v_scan := regexp_replace(v, 'https://wa\.me/254702904562(?![0-9a-z])', '', 'g');
  for dom in
    select m from regexp_matches(
      v_scan, '((?:[a-z0-9][a-z0-9-]*\.)+(?:com|co\.ke|or\.ke|ac\.ke|sc\.ke|org|net|io|app|me|ly|info|biz|xyz|link|ke))\M', 'g'
    ) as t(m)
  loop
    if dom[1] <> 'educoreafrica.com' and dom[1] not like '%.educoreafrica.com' then
      return 'Links and addresses may only point to educoreafrica.com (found "' || dom[1] || '").';
    end if;
  end loop;

  -- A "service" message must not read like an offer, or it would skip the stricter promotional gate.
  if p_kind = 'service'
     and v ~ '(\m(discount|discounted|promo|promotion|promotional|coupon|voucher|waive|waived)\M|% off|percent off|special offer|limited[- ]time|free month)' then
    return 'This reads like an offer. Send it as a promotional message instead.';
  end if;

  return null;
end;
$function$;

update public.onboarding_email_templates
   set subject = $subject$Your EduCore account is ready to use$subject$,
       body = $body$Hello {{name}},

Welcome to EduCore!

We're delighted to let you know that your {{school}} account is ready. Thank you for choosing EduCore to simplify the management of your school.

You can now sign in and begin setting up your school's digital workspace.

GET STARTED WITH EDUCORE
Sign in to your account using the link below:
https://www.educoreafrica.com/login

Once logged in, you can start configuring your:

* Academic year and school calendar
* Classes and streams
* Student records
* School fee structure
* Other essential school settings

NEED HELP GETTING STARTED?
We're here to make your onboarding experience as smooth as possible.
If you have any questions or need assistance setting up your school, simply reply to this email or contact us directly on WhatsApp.
Click here to chat with us on WhatsApp: https://wa.me/254702904562

We're excited to have you on board and look forward to supporting your school's journey with EduCore.

Warm regards,
The EduCore Team
Making School Management Simpler.$body$,
       updated_at = now()
 where rule_key = 'login_guidance_email';

update public.onboarding_email_templates
   set subject = $subject$Finish setting up your EduCore account$subject$,
       body = $body$Hello {{name}},

Thank you for registering {{school}} on EduCore!

We noticed that you haven't completed the password setup for your account yet. Until your password is created, you won't be able to sign in and access your school's dashboard.

LET'S GET YOUR ACCOUNT READY
Please follow these simple steps:

1. Check your email for the password setup link sent during registration.
2. Open the link and create your account password.
3. Once completed, sign in to EduCore and begin setting up your school.

CAN'T FIND YOUR PASSWORD SETUP EMAIL?
No worries! You can request a new password reset link using the link below:
https://www.educoreafrica.com/forgot-password

Once your password is set, you'll be ready to access your EduCore account and start managing your school's operations.

NEED A HAND?
Our team is happy to assist you.
You can reply directly to this email or chat with us on WhatsApp for quick assistance.
👉 Click here to chat with EduCore Support on WhatsApp: https://wa.me/254702904562

We're looking forward to helping you get started!

Warm regards,
The EduCore Team
Making School Management Simpler.$body$,
       updated_at = now()
 where rule_key = 'password_reminder_email';
