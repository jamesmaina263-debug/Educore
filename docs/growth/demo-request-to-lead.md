# Growth Engine: website demo request -> sales pipeline lead

Part of the Growth Engine work (PR 4 of 5). One migration plus one button. **Nothing is sent to the visitor and
nothing runs automatically.** Migration: `supabase/migrations/20261017180000_demo_request_to_sales_lead.sql`.
Test: `supabase/tests/demo_request_to_lead.sql` (rollback-only, synthetic data).

## The problem

A demo request (`marketing_demo_requests`) and a CRM lead (`sales_leads`) were unrelated records, so a website
enquiry only entered the pipeline (stages, follow-up date, activity log) if someone retyped it. `sales_leads` stays
the single CRM and `marketing_demo_requests` stays the raw inbound record; this adds the link and a one-click,
human-triggered conversion.

## What it adds

- `marketing_demo_requests.sales_lead_id` (nullable, `on delete set null`): which lead a request became or joined.
  Several requests can share one lead.
- `admin_convert_demo_request_to_lead(p_request_id, p_assigned_to default null)` returns
  `{lead_id, created, already_linked, lead_name}`.
- `/admin/demo-requests`: an **Add to sales pipeline** button in the expanded row, an "In sales pipeline" marker, and
  a link to the pipeline once converted.

## Rules (enforced in the database)

- **Idempotent.** Converting a request that is already linked returns its lead; a double click cannot create two.
- **No duplicate leads.** A lead with the same school name, email or phone (phones compared after normalising
  `0712…` / `+254712…` / `254712…`) is linked instead, and the repeat enquiry is noted on its activity log. Matching is
  by name/email/phone only, so two different schools with the same name in different towns would be merged:
  check the lead name shown after conversion.
- **New lead:** stage `new`, source `inbound_web`, follow-up due today (East Africa Time), assignee taken from the
  request (or the one passed in), notes carry the visitor's message and campaign (utm source / medium / campaign).
  The stage is never advanced: `demo_booked` must only be set when a rep actually books a demo.
- **Existing open lead:** a repeat enquiry brings a later follow-up date forward to today, never pushes an overdue date
  back, and leaves closed (`paid` / `lost`) leads untouched.
- The request's own status (`new` / `contacted` / `assigned` / `closed`), the public form, its insert path and the
  new-lead notification are not changed.
- Super admin only; revoked from `public` / `anon`; raises a real error if the request does not exist. Out-of-range
  student counts are dropped rather than blocking the conversion.

## Deploy order

Needs `20260924130000_sales_pipeline_crm.sql` and `20261017150000_outbound_contact_log_and_opt_outs.sql` (reuses its
`_normalize_contact_identifier` helper). The page reads the new column in a separate query, so if the code is live a
moment before the migration only the marker is missing, not the list; the button errors until the migration lands.

## Rollback

Additive. Stop using the button, then drop the function and the column in a follow-up migration. Leads already
created stay in `sales_leads` (they are ordinary CRM rows).

## Not covered

Automatic conversion on form submit (deliberately left manual so the public insert path is untouched), converting the
incomplete step-1 leads, a booked-demo status (needs a real booking), and the lead/conversion report (PR 5).
