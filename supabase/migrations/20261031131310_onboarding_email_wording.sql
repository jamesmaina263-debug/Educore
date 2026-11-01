-- New wording for the two automatic onboarding emails (password reminder, login guidance).
--
-- Only the text of the two rows in onboarding_email_templates changes. Nothing else is touched: no table, column,
-- policy or function is altered, and nothing is sent. Safe to run twice (a plain UPDATE to fixed values).
--
-- Approval: automatic sending is bound to a hash of the exact template text (onboarding_settings.templates_approved_hash).
-- Changing a template makes any earlier approval stop matching, so sending pauses until a super admin approves this
-- new wording on /admin/onboarding. At the time of writing nothing has been approved, so nothing is affected.
--
-- Safeguards: the text was checked with the existing _trial_nudge_content_problem('service', ...) rules and passes.
-- Those rules only allow links to educoreafrica.com, so WhatsApp support is given as a plain phone number rather than
-- a wa.me link. Only the {{name}} and {{school}} placeholders are used. The rules are unchanged.

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
WhatsApp Support: +254 702 904 562

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
👉 Chat with EduCore Support on WhatsApp: +254 702 904 562

We're looking forward to helping you get started!

Warm regards,
The EduCore Team
Making School Management Simpler.$body$,
       updated_at = now()
 where rule_key = 'password_reminder_email';
