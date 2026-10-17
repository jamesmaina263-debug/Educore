# Growth Engine: outbound contact log and opt-outs

Part of the Growth Engine work (PR 2 of 5). One migration, one label. **Nothing in this PR sends a message.**
Migration: `supabase/migrations/20261017150000_outbound_contact_log_and_opt_outs.sql`.
Test: `supabase/tests/outbound_contact_log.sql` (rollback-only, synthetic data).

## What it adds

| Object | Purpose |
|---|---|
| `prospect_channel_opt_outs` | Opted-out numbers per channel (`whatsapp`, `sms`, `phone`). Email is **not** duplicated: it uses the existing `marketing_email_suppressions`. |
| `outbound_contact_log` | Manual, self-reported log of what a rep did with a prospect's draft (`draft_copied`, `sent`, `replied`, `opted_out`). It records what a person says they did, not delivery. |
| `admin_log_outbound_contact()` | Writes a log row. Refuses unless the prospect is approved/promoted, its found contact details (scraped / AI-found) have been confirmed by a person, it has a usable address/number, and it has not opted out. `replied` is always allowed. |
| `admin_record_outbound_opt_out()` | Records a STOP / "do not contact". Idempotent; phone numbers are normalised so `0712…`, `+254712…` and `254712…` are one entry. |
| `admin_is_outbound_contact_blocked()` | Read-only check for the UI (PR 3). |
| `admin_import_outbound_prospects()` | Same behaviour, now also skips existing schools, demo requesters, sales leads sharing an email/phone, and opted-out contacts. Result gains `skipped_opted_out`. |
| `admin_promote_outbound_prospect()` | Same behaviour as the current version (including the confirm-found-contacts gate from `20261017120000_outbound_contact_enrichment.sql`); new leads get source `outbound` instead of `other`. |
| `sales_leads.source` | CHECK widened to allow `outbound` (no row can violate a wider list). |

All access is super admin only: tables have a super-admin SELECT policy and no write grants; functions check
`auth_is_super_admin()` and are revoked from `public`/`anon`.

## Design decisions

- Opt-outs are one-way in the app. There is deliberately no function that removes one; reversing it is a manual
  service-role action on the person's own request.
- The opt-out register is kept when a prospect is deleted (we must keep honouring it); the contact log is deleted
  with the prospect.
- Opt-outs are per channel for contact, but an opted-out number is skipped on import whatever the channel.
- Existing promoted leads keep source `other`. There is no backfill.

## Deploy order

This migration is `20261017150000` and must apply after `20261017120000_outbound_contact_enrichment.sql` (it reads
`contact_status` and rebuilds promote on top of that migration's version). Do not renumber it earlier.

Apply the migration before relying on it. Merging to `main` applies it through the Deploy migrations workflow, in
parallel with the Vercel build. The only app change is a label in the sales source list, which is safe either way.

## Rollback

The migration is additive. To undo: stop using the new functions (nothing calls them yet), then drop the two new
tables and functions in a follow-up migration. Restoring the old import/promote bodies means re-applying
`20261016140000_outbound_school_level.sql`. Do not remove `'outbound'` from the source CHECK while any lead uses it.

## Not covered here

The UI that calls these functions (PR 3), and legal review of contacting imported lists under the Kenya Data
Protection Act, which this PR does not claim to settle.
