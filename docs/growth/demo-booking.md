# Growth Engine: manual demo booking (Phase 2, item C)

A person on the sales team records a demo for a sales lead (when, how, who runs it), then marks it held, no-show or
cancelled. It makes the `demo_booked` and `demo_done` pipeline stages mean a real, dated demo. **Nothing is sent to the
school, no calendar or video provider is involved, and no reminder goes out.** It is a record of what a person arranged
themselves. Migration: `supabase/migrations/20261018190000_sales_lead_demos.sql`. Test:
`supabase/tests/sales_lead_demos.sql` (rollback-only, synthetic data).

## Where it shows

- `/admin/sales-pipeline`: a **Demos** section in each lead's detail (Book a demo, Reschedule, Held, No-show,
  Cancel demo) and an **Upcoming demos** panel above the list (soonest first; a past demo with no outcome is flagged
  "Record the outcome").
- Times are entered and shown in East Africa Time.
- "Working as" (top of the pipeline) must be chosen first, the same as when logging an activity.

## Rules (enforced in the database, mirrored in the UI)

- One **scheduled** demo per lead at a time (partial unique index). Reschedule or cancel it before booking another.
- Only an open lead (not `paid` / `lost`) can have a demo booked, and only for a future time.
- **Booking** moves the stage to `demo_booked` only from `new`, `visited`, `decision_maker_met`. A lead already at
  `demo_booked`, `demo_done`, `pilot` or `paid` keeps its stage. The follow-up date is brought forward to the demo day
  if empty or later; an earlier one is never pushed back.
- **Held** (only after the start time) moves `new..demo_booked` to `demo_done`; never backwards, never touches a lead
  already at `demo_done` / `pilot` / `paid` or a lost lead.
- **No-show** (only after the start time) leaves the stage alone and brings the follow-up date forward to today (EAT).
- **Cancelled** leaves the stage alone.
- A demo can be closed out only from `scheduled`. Repeating the same action is a no-op (no duplicate activity);
  a different action on an already-closed demo raises an error.
- Every change writes one `demo` row to the lead's activity log. Stage moves go through the existing
  `admin_set_sales_lead_stage()`, so they are logged exactly like manual stage changes.
- Super admin only. Table is read-only to clients; writes are `SECURITY DEFINER` functions that re-check super admin.
  The audit log gets ids and coded values only, never the location/link or the outcome note.

## Limits (deliberate, be honest about these)

- **A cancelled or no-show demo leaves the lead at `demo_booked`.** Stage history is not tracked, so there is no safe
  "previous stage" to return to. The Demos section and the activity log show what happened; move the stage by hand if
  the lead should step back.
- The growth report counts "reached demo booked" from the CURRENT stage, so a lead whose demo was cancelled still
  counts as booked. Demos booked before this feature have no demo record.
- Self-reported: held / no-show is what a person says happened.
- No edit of a closed demo and no delete in the UI; record a new one. Notes: keep to school-level facts, no learner data.
- No reminders, invitations or calendar entries. Those would need a provider decision and consent rules (items B / D).

## Deploy order

Needs `20260924130000_sales_pipeline_crm.sql`. The page reads demos in a separate query: if the code is live a moment
before the migration, the pipeline still loads and shows a notice instead of the demo panel.

## Rollback

Additive. Stop using the section, then drop the table and the four functions in a follow-up migration. Leads and their
activity rows are ordinary CRM rows and stay.
