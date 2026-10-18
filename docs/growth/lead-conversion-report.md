# Growth Engine: lead and conversion report

Part of the Growth Engine work (PR 5 of 5). One read-only database function and one section on `/admin/analytics`.
Migration: `supabase/migrations/20261017200000_growth_report.sql`. Test: `supabase/tests/growth_report.sql`
(rollback-only, synthetic data, delta-based so existing data cannot skew it).

## What it shows ("Pipeline and conversion", under the existing analytics page)

Uses the page's own date range (Kenya-time days). Every figure is **measured** from EduCore's records.

| Panel | Source | Bound to the period? |
|---|---|---|
| Website demo requests to pipeline (total, in pipeline, not yet) | `marketing_demo_requests.sales_lead_id` (PR 4) | yes |
| Leads created, by source | `sales_leads` | yes |
| Pipeline today (open, overdue, due today, no follow-up, per stage) | `sales_leads` | **no: snapshot of today** |
| Leads created in the period: where they are now | `sales_leads.stage` | yes (cohort, current stage) |
| Demo requests by campaign (requests, in pipeline, demo done+, paid) | requests joined to their lead | yes |
| Lost leads and the reasons staff gave | `sales_leads` | yes |
| Trials started, where those schools are now, paid an invoice, by signup campaign | `school_subscriptions`, `platform_invoices`, `marketing_signup_attribution` | yes (cohort) |
| Outreach AI usage (calls, tokens) | `platform_admin_activity_log` | yes |

## Honesty rules built in

- **Not tracked yet is not zero.** Demo attendance/outcomes, trial activation milestones, email/WhatsApp/social
  engagement and AI spend in money have no data source; they are listed as not tracked, never shown as 0.
- **No cost estimates.** AI usage is tokens only; no verified prices are on file. Only the outreach tools log usage, so
  other AI features are not included.
- **Current stage, not history.** "Where they are now" cannot say a lead once reached a demo and was then lost (stage
  history is free text in the activity log). The panel says so.
- **Empty is not 0%.** A rate with nothing to divide by is blank. Groups under 10 carry a "read as anecdotes, not a trend"
  note; no significance is claimed.
- **Undercount warning.** Requests that arrived before "Add to sales pipeline" existed were never linked, so older
  periods read low for in-pipeline, demo-done and paid.
- Trial figures are school-level aggregates and include any internal test/demo schools. No school is named; no learner data
  is read.
- If the report cannot load (for example the migration has not applied yet), the section shows a plain message and **no
  numbers** instead of zeros.

## How it works

`admin_growth_report(p_from date, p_to date)` returns one jsonb document of aggregates. It is `STABLE` (cannot write),
SECURITY DEFINER, super admin only, revoked from `public`/`anon`, and rejects a null/reversed range or one over 400 days.
One call per page render replaces many row-level queries; the tables are small, so no caching layer is added. If a table
grows large, add an index on the date column it filters first, or cache the result per date range.

`src/lib/growth/report.ts` validates the response (missing sections become zeros, bad numbers are dropped, never NaN) and
holds the wording helpers. `src/components/admin/analytics/growth-report.tsx` renders it. `analytics/page.tsx` gained 3
lines: the import and the `<GrowthReport startIso endIso />` mount.

## Deploy order

Needs `20261017180000_demo_request_to_sales_lead.sql` (the `sales_lead_id` column). The section degrades to the message
above if the code is live a moment before the migration.

## Rollback

Additive. Remove the mount line from `analytics/page.tsx` (the component is self-contained), then drop the function in a
follow-up migration. Nothing else depends on it.

## Not covered

Demo booking and attendance data, per-day trial milestones, campaign sending/engagement, structured stage history (would
allow "ever reached" and time-in-stage), and any money figure for AI spend.
