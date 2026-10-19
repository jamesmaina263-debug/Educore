# Growth Engine: trial nudges (Phase 2, item D)

Emails to the **owner** of a trial school, behind a human approval queue and hard consent and frequency rules.
Page: `/admin/trials/nudges` (linked from `/admin/trials`). Migration: `supabase/migrations/20261018220000_trial_nudges.sql`.
Tests: `supabase/tests/trial_nudges.sql` (rollback-only, synthetic data, never sends), plus unit, action and render tests.

**Nothing is sent automatically, and nothing is sent at all until someone turns sending on.** Sending and promotional
sending are two switches, both OFF by default. Merging this changed nothing for any school.

## The flow

1. **Propose** (person, who they are is required): pick a school, a kind, write or start from a template. The database
   resolves the recipient (the school's active owner; never typed) and refuses anything that breaks a rule below.
2. **Approve** (person, who they are is required): the reviewer approves *the exact text they were shown*. Approve passes
   the hash of what was on screen; if the text changed in the meantime the approval is refused. Approved text cannot be edited.
3. **Send now** (person clicks, with a confirm): the database re-checks every rule, then hands the message to the
   **existing** campaign pipeline: a one-recipient `email_campaigns` row whose recipient carries the approved text as
   `custom_subject` / `custom_body`. The existing `send-owner-campaign` Edge Function sends it (campaign sender identity,
   unsubscribe link, `List-Unsubscribe` headers, skips addresses in `marketing_email_suppressions`). No Edge Function changed.
4. The result is read back from the campaign recipient. A message that was sent is also recorded as an **email check-in**
   on the school (`trial_checkins`), so the Trial follow-up page treats it as contacted and does not suggest the school again.

## Two kinds

- **Service**: about the school's own trial (welcome, check-in, ending soon). Only for trials that are **running**.
  Three starter texts are provided. They state only the 30-day free trial and "no card required", and make no offer,
  price or approval claim. A service message that reads like an offer (discount, promo, coupon, "% off", free month, ...)
  is refused, so an offer cannot skip the stricter promotional gate.
- **Promotional**: offers and marketing. For running trials **or** trials that ended in the last 14 days (the win-back
  list). There is no promotional starter on purpose: whoever proposes an offer must write it and make sure it is true.
  **Nothing on this page creates a discount, changes a price or touches a subscription.**

## Rules (database-enforced; propose, approve and send each re-check them)

- **Recipient**: the school's earliest active `school_owner` with an email. If that address changes after approval,
  sending is refused. Demo, `qa-*` and test-address schools are never messaged.
- **Never** to an address in `marketing_email_suppressions` (both kinds), never to a school with an `asked_to_stop`
  check-in (both kinds), and promotional never to a school with a `reached_not_interested` check-in.
- **Frequency**: one open (proposed or approved) message per school; at most one message per school in 3 days (any kind);
  at most 2 promotional per school in 30 days; at most 30 queued or sent platform-wide per 24 hours.
- **Lifetimes**: an approval is valid for 24 hours, a proposal for 7 days. Lapsed ones are marked `expired`.
- **Content**: at most 200 characters of subject and 4000 of body; only `{{name}}` and `{{school}}` placeholders; no
  "no obligation", no KICD or Ministry approval claims, no "guaranteed", no "free forever"; links and addresses may only
  point at educoreafrica.com. The TypeScript copy of these rules (for the form) is checked against the database function
  on the same inputs; the database is the authority.
- **Access**: super admin read only; every write is a `SECURITY DEFINER` function that re-checks super admin. The audit
  log gets ids and coded values only: never an address, subject or body.

## What is still your decision (not settled by this change)

- **Legal.** Whether and how you may email trial schools, and especially promotional messages, under Kenya's Data
  Protection Act is the open legal review from the handover. The promotional switch exists so it can stay off until that
  is settled. This change does not make any message lawful.
- **Turning it on.** Both switches are at `/admin/trials/nudges` ("You are" must be chosen first). Sending also needs
  `CAMPAIGN_FROM_ADDRESS`, `CAMPAIGN_REPLY_TO` and `RESEND_API_KEY` set on the Edge Function, as for any campaign; if they
  are missing the send fails with that message and the nudge shows as failed or still sending.

## Limits (deliberate, be honest about these)

- **The admin console is a shared login.** "Who proposed / who approved" is a team member the person picks, not proof of
  who was at the keyboard. Nothing stops the same person proposing and approving; the queue gives you a second look, not
  enforced separation of duties.
- **Email only.** No WhatsApp, SMS or in-app message. WhatsApp for sales (item B) is a separate decision.
- **Manual, one at a time.** No scheduling, no automation, no rules that propose messages for you.
- **A send that never finishes** (the Edge Function dies mid-send) leaves the message "Sending"; Check status re-reads it
  but cannot unstick a recipient stuck in `sending`. Rare; a person decides what to do.
- A promotional message to a school that was marked "not interested" is blocked, but a "reached: needs more time" or "no
  answer" check-in does not block anything beyond the 3-day gap.
- Test and demo detection is by slug (`demo-academy`, `qa-*`) and address (`@educore.test`, `.test`). A real internal test
  school with another name would not be recognised.
- The page lists at most the latest 200 messages. The pipeline's campaign history will also show these one-recipient
  campaigns ("Trial message: <school>").
- Self-reported outcomes elsewhere are unchanged; only a message that really went through the email provider writes the
  email check-in.

## Deploy order and rollback

Needs `20261002120000_owner_email_campaigns.sql`, `20261018150000_trial_checkins.sql` and `20261018180000_outreach_email_campaigns.sql`.
If the code is live a moment before the migration, the page says the queue could not be read and nothing can be sent.
Additive: to roll back, stop using the page and drop the two tables and the functions in a follow-up migration. Campaign
rows already created stay in the existing campaign history.
