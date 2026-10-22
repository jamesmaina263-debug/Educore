# Growth Engine: sales WhatsApp, first PR (Phase 2, item B)

A consent register and an approval queue for WhatsApp messages to people who contacted EduCore. Page: `/admin/sales-whatsapp`
(linked from `/admin/sales-pipeline` and `/admin/trials`). Migration:
`supabase/migrations/20261019160000_sales_whatsapp_consent_queue.sql`. Test: `supabase/tests/sales_whatsapp.sql`
(rollback-only, synthetic data).

**Nothing is sent by the system in this version.** There is no Twilio code yet. A person sends an approved message from their
own WhatsApp (the button opens WhatsApp with the text filled in, they press send) and then marks it as sent. Sending through
Twilio, and reading replies and STOP, is the second PR (see "Before the Twilio PR").

## Who can be messaged: only people who agreed, and only for what they agreed to

- **Demo form.** The public `/contact` form now has a WhatsApp tick-box, **never ticked by default**, with these exact
  words (stored with the agreement, as the visitor saw them): *"Yes, you may message me on WhatsApp, on the phone number above,
  about my demo request and free trial. I can reply STOP at any time."* (`WHATSAPP_CONSENT_LABEL` in
  `src/lib/marketing/demo-request.ts`). That covers messages about their demo request and trial **only** (scope `service`),
  never promotions. Choosing WhatsApp as the preferred contact method does **not** count as agreement.
- **Team-recorded.** For anyone else (for example a trial-school owner), a team member records that the person agreed
  (call, in person, WhatsApp reply, email, other), their name and number, and whether it also covers promotional messages
  (scope `service_and_promotional`). Only record it if they really said yes.
- **Withdrawing** an agreement cancels any open message and writes a permanent WhatsApp opt-out into
  `prospect_channel_opt_outs` (the same register outreach uses), so the number is blocked everywhere. The app never removes
  opt-outs, so a withdrawn number cannot be re-added through the form or by hand (a deliberate, conservative choice).

## The flow

1. **Propose** (a named team member): pick a person who agreed, a kind, write the text. Sent exactly as written, so
   `{{placeholders}}` are refused: write the person's name yourself.
2. **Approve** (a named team member): approve *the exact text shown* (hash-bound; approved text cannot be edited).
3. **Send from WhatsApp, then mark as sent.** "Open in WhatsApp" fills the text in; "I sent it: mark as sent" asks you to
   confirm you really sent it. The system only records what the person says.

## Rules (database-enforced; propose, approve and mark-sent each re-check them)

- Active agreement required, and the number not in the WhatsApp opt-out register.
- Promotional only with a `service_and_promotional` agreement **and** while the promotional switch is ON (it starts OFF; the
  Data Protection Act position on marketing messages is still your open legal decision).
- One open message per person; at most one message per person in 2 days; at most 2 promotional per person in 30 days; at most
  40 marked sent per 24 hours.
- Approval valid 24 hours, proposal 7 days. Same claim, link and offer rules as trial emails (no "no obligation", no
  KICD/Ministry approval claims, links only to educoreafrica.com, an offer cannot be sent as "service"), at most 1000 characters.
- Access: super admin read only; every admin write is a `SECURITY DEFINER` function that re-checks super admin; the only
  public path (`record_demo_whatsapp_consent`, called by the `/contact` server action) is executable by `service_role` only.
  Audit-log entries carry ids and coded values only: never a number, name or message text.

## The public form change (read this)

The `/contact` server action now picks the request's id up front and, after the lead is saved, records the agreement if the box
was ticked. That step is best effort: if it fails (or the new table is not there yet during a deploy), the visitor still sees
success and the lead is saved exactly as before; a team member can record the agreement by hand. No other field, validation or
anti-spam behaviour changed.

## Limits (deliberate, be honest about these)

- **Past demo requests have no agreement on file**, including people who chose "WhatsApp" as their preferred method. They are
  not backfilled: agreement has to be explicit. A team member can record it after asking.
- Self-reported: "marked as sent" is what a person says, not proof of delivery. The page cannot tell if a message was read.
- The shared admin login means "who proposed / approved / sent" is a self-picked team member, and nothing stops one person
  doing all three.
- Phone numbers are stored in international form (254XXXXXXXXX for Kenyan numbers). A number the normaliser cannot read is
  silently not recorded from the form (the lead is still saved).
- A consent row stores a school name as typed, plus an optional link to a school or demo request; it does not follow later changes.

## Existing wording to review (not changed here)

The demo form's footer still says "No obligation, no payment." The Growth Engine wording rule is "30-day free trial. No card
required." and not "no obligation". That sentence predates this work and is outside this PR; flagging it so it can be fixed
separately.

## Before the Twilio PR (what only you can do)

Nothing exists yet for sales on WhatsApp (status and decisions as of 2026-10-21 are in the next section). For the second PR you will need, in Twilio and Meta:

1. A **separate WhatsApp-enabled number for sales** (not the parent-bot number), registered as a Twilio WhatsApp sender, with
   Meta business verification and an approved display name.
2. **Approved message templates** (Twilio Content Templates, approved by WhatsApp) for the first message to someone who has not
   messaged you in the last 24 hours. Utility templates (demo reminder, trial check-in) and marketing templates are priced and
   reviewed differently. I can draft the wording.
3. Secrets for the sales sender (account SID, auth token or API key, sender number, webhook auth) set in Supabase, and the
   inbound webhook URL for the sales number pointed at the new function (not the parent bot's).
4. A decision on cost: WhatsApp business-initiated messages are billed per message by Twilio and Meta.

The second PR then adds: sending approved messages through Twilio as templates, a separate inbound webhook for the sales
number (signature-verified, STOP and similar words withdraw the agreement and record the opt-out, replies stored and shown),
delivery status, and a sending switch that starts OFF.

## Setup decisions and status (recorded 2026-10-21)

**Status when this was written**
- No Meta Business Portfolio exists yet for EduCore, so there is nothing to verify yet.
- The business registration is **underway** (not finished), so the documents Meta needs for business verification do not exist yet.
- Nothing is registered for sales in Twilio. The second PR is therefore **not started** and is blocked on the sender and
  templates, by design (so it can be tested against a real sender).
- Unknown: whether the parent bot runs on Twilio's shared WhatsApp sandbox (testing only) or on a registered sender. The repo
  only reads one `TWILIO_WHATSAPP_FROM` value, so it cannot tell. To check: Twilio Console > Messaging > Senders > WhatsApp
  senders. A registered sender is listed there; a sandbox is not. If it is the sandbox, real parents are being served by a
  testing sender, and the same verified Meta business could later cover both numbers.

**Decision: which number sales uses**
- The sales number is a business number that is **already on the WhatsApp Business app**. The owner's personal number stays
  personal and is not used for sales. (Numbers are kept out of this document on purpose.)
- **Now:** use the sales number in the WhatsApp Business app with the manual flow on `/admin/sales-whatsapp`.
- **Later:** migrate it to Twilio, but only once Meta business verification is complete and the templates are approved.
- Why the order matters: Twilio's migration guide says a number that is registered on WhatsApp or the WhatsApp Business app has to
  have that account **deleted** first, after which the number can no longer be used in either app. Until verification is complete
  a number can sit in a pending state and cannot send, so deleting the app account early would leave the number with no
  WhatsApp at all. Coexistence (one number on the Business app and the API together) exists at Meta, but Twilio support is
  unconfirmed (no Twilio documentation was found for it), so assume the number leaves the app.
- **Migration steps when the time comes:** back up the Business-app chats; confirm verification and template approval; delete
  the Business-app account on the number; register it as a Twilio WhatsApp sender; set the sales secrets; point the sales
  inbound webhook at the new function; then build and enable the second PR (sending switch starts OFF).

**Until Twilio is live, STOP is handled by hand.** Replies arrive in the Business app, which this system cannot see. If someone
says stop, no, or similar, open their entry on `/admin/sales-whatsapp` and use Withdraw (it cancels open messages and writes the
permanent opt-out). Automatic STOP handling comes with the Twilio PR.

**Order of work (all owner actions until step 4)**
1. Finish the company registration. Use the exactly registered spelling of the name in the Business-app profile, on the website
   and in Meta. (The name was written two different ways in conversation; confirm the registered one.)
2. Create the Meta Business Portfolio under the registered name and submit business verification. Meta's review can take up
   to 2 to 4 weeks after the documents are submitted.
3. Create the Twilio WhatsApp sender and submit the template drafts below for approval.
4. Report back; then the second PR is built and tested against the real sender.

**Costs (as found on 2026-10-21; re-check before relying on them)**
- Meta charges per delivered template message (since 1 July 2025). Published Kenya rates: roughly USD 0.004 for utility and
  USD 0.0225 for marketing messages (third-party rate table, matched by press reporting). From 1 October 2026 Meta also charges
  for replies after 1,000 free per number per month, and for utility templates sent inside the 24-hour window.
- Twilio adds its own per-message fee. Its rate was **not** looked up.
- At the 40-a-day platform cap, the all-marketing worst case is about USD 0.90 a day.

**Template drafts to submit** (Meta decides the final category; promotional wording will likely be classed as marketing).
There is deliberately **no promotional template**: an offer has to be written by the owner, be true, and wait for the legal
review of marketing messages under Kenya's Data Protection Act.
- `demo_request_received` (utility): "Hello {{1}}, thank you for requesting an EduCore demo for {{2}}. We will contact you on
  this number to agree a time. If you prefer another way, just reply here. Reply STOP to stop WhatsApp messages."
- `demo_reminder` (utility): "Hello {{1}}, a reminder that your EduCore demo for {{2}} is on {{3}} at {{4}}. Reply here if you
  need to change the time. Reply STOP to stop WhatsApp messages."
- `trial_checkin` (utility, may be classed as marketing): "Hello {{1}}, this is the EduCore team checking how the free trial for
  {{2}} is going. Is there anything we can set up or explain? Just reply here and we will help. Reply STOP to stop WhatsApp
  messages."

**Sources used** (Twilio and Meta documentation, October 2026): Twilio WhatsApp Self Sign-up
(`twilio.com/docs/whatsapp/self-sign-up`), Twilio "Migrate phone numbers and WhatsApp senders"
(`twilio.com/docs/whatsapp/migrate-numbers-and-senders`), Twilio "Register senders using the API"
(`twilio.com/docs/whatsapp/register-senders-using-api`), Meta WhatsApp Business Platform pricing
(`developers.facebook.com/docs/whatsapp/pricing`).

## Deploy order and rollback

Needs `20261017150000_outbound_contact_log_and_opt_outs.sql`, `20261018220000_trial_nudges.sql` (shared content rules) and
`20260828203537_marketing_demo_requests.sql`. If the code is live a moment before the migration, the page says the records could
not be read and the demo form still works. Additive: to roll back, stop using the page and drop the three tables and the
functions in a follow-up migration (the tick-box would then record nothing).
