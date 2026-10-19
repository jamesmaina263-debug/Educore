# Growth Engine: trial check-in log (Phase 2, item A)

A small manual log on `/admin/trials`: when a person on the platform team checks in with a trial school, they record
it (how, outcome, who, optional note). The page then shows each school's last check-in and stops suggesting a school
that was just contacted, so nobody is chased twice. **Nothing is sent, no subscription changes, no discount is offered.**

## What changed on the page

- **Log check-in** button on every school in "Needs a check-in", "Followed up" and "Trial ended recently".
- **Last check-in** column (channel, outcome, date, who, number of check-ins) everywhere a school is listed.
- **Followed up** list: a flagged trial that was checked in with in the last 3 days (`RECENT_CHECKIN_DAYS` in
  `src/lib/growth/trial-checkins.ts`) moves here from "Needs a check-in". It stays visible with its flags, and returns
  to "Needs a check-in" once the wait is over and it is still flagged.
- **Asked not to be contacted**: if any check-in has the outcome `asked_to_stop`, that school is never put back on
  "Needs a check-in", however old the check-in is. It is a standing request.

## Data

New table `trial_checkins` (migration `20261018150000_trial_checkins.sql`): school, channel (call, whatsapp, email,
visit, other), outcome (reached_interested, reached_needs_time, reached_not_interested, no_answer, message_left,
asked_to_stop), optional team member (`platform_team_members`), optional note (500 characters), timestamp.

- Read: super admin only (RLS). Write: only through `admin_log_trial_checkin()` (SECURITY DEFINER, checks super admin,
  checks the school exists and has a subscription row). No direct insert, update or delete for any client role.
- Rows are deleted with the school; removing a team member keeps the log and clears the name.
- The audit log (`logAdminAction`) records ids and the coded channel/outcome only, never the note.
- School-level only. The note placeholder says "No learner details".

## Limits (deliberate)

- Self-reported: it records what a person says they did, not that a message was delivered.
- The one exception: a trial message that really went out through the email provider (see `trial-nudges.md`) writes an
  email check-in automatically, so the school is treated as contacted.
- There is no edit or delete in the UI; a wrong entry is corrected by logging another one.
- The 3-day wait applies equally to every flag, including "ending soon". A school checked in with 2 days ago and ending
  tomorrow sits in "Followed up" (with its days left shown) rather than "Needs a check-in".
- `asked_to_stop` hides the school from suggestions only. It is not an opt-out register: it does not block anything
  else, and it does not touch `prospect_channel_opt_outs` or `marketing_email_suppressions`.
- If the log cannot be read, the page still loads and says so, so an empty column is not mistaken for "nobody contacted".
- The page reads at most the latest 2000 check-ins for the schools shown.

## Tests

`trial-checkins.test.ts`, extra cases in `trial-followup.test.ts` and `trial-followup-data.test.ts`, the server action
in `app/(admin)/admin/trials/actions.test.ts`, and the rollback-only database test `supabase/tests/trial_checkins.sql`.
