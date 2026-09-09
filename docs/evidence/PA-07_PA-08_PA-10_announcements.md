# PA-07 / PA-08 / PA-10 — Announcements evidence (GTM Readiness Protocol)

Date: 2026-09-08

These three were merged via PR #149 (2026-08-31/09-01) but, per the tracker, never
independently re-tested live the way PA-04/07/09 were. This pass runs the real
workflow end-to-end for each against the real tracker DoD.

## PA-07 — Schedule announcements
**DoD:** Authorised user can set a future publish date/time.

Created a real announcement via `create_announcement()` with `scheduled_at` 3
seconds in the future, targeted at the test learner's stream. Confirmed:
- It landed with `status = 'draft'` and was correctly **invisible** to the
  guardian while still scheduled (not yet due).
- After the scheduled time passed, called `publish_due_scheduled_announcements()`
  (the exact function the cron route at `/api/cron/announcements` calls) —
  returned `published_count: 1`, matching only our announcement.
- The guardian could then see it as `status = 'published'` with a real
  `published_at` timestamp.

**Status:** Confirmed working end-to-end. No fix needed.

## PA-08 — Attach circulars, assignments and documents
**DoD:** Supported files upload, scan and open reliably.

Couldn't drive an actual multipart file upload from this environment (no browser,
and Supabase Storage's upload endpoint isn't reachable from here), so verified
everything *except* the literal HTTP upload — the part that's genuinely custom
application logic:
- Called `record_announcement_attachment()` for the published PA-07 test
  announcement, as the school owner. Succeeded, returned a real row.
- Inserted a matching `storage.objects` row at the exact path convention the
  action uses (`{school_id}/{announcement_id}/{ts}-{name}`), to exercise the real
  storage RLS policy, not just the metadata table.
- As the guardian: confirmed both the `announcement_attachments` row and the
  `storage.objects` row are visible under their respective RLS policies — the two
  checks `getAnnouncementAttachmentUrlAction` and the portal's attachment list
  both depend on.

**Status:** Access-control layer confirmed correct. The multipart upload call
itself is a standard Supabase Storage client call, not custom logic, and wasn't
independently re-verified here.

## PA-10 — Organised announcement history (search/filter)
**DoD:** Guardians can search or filter current and previous notices.

Confirmed the client-side search/urgency/read filters exist and are wired to a
query with no status restriction (`portal-announcements.tsx`, `page.tsx`).

**Real bug found and fixed:** created a second announcement, published it, then
withdrew it (`withdraw_announcement()`) — and it **vanished entirely** from the
guardian's fetch, despite a real `announcement_recipients` row still existing.
Root cause: `announcements_select`'s guardian/student branch required
`status = 'published'`, with no allowance for `'withdrawn'`. This directly
contradicts the design intent already written into `withdraw_announcement()`'s own
migration comment ("Recipients rows are kept ... so read/ack history survives the
withdrawal, per PA-13's audit requirement") — and the client already has real,
previously-unreachable UI for this exact case (a dimmed card, "Withdrawn" badge,
and the withdrawal reason).

Fixed by widening the guardian branch to `status in ('published', 'withdrawn')` —
the only two statuses a recipient could ever legitimately have a row for, since
`withdraw_announcement()` itself only operates on already-published announcements.
Verified after the fix: both the live and the withdrawn test announcement now
appear for the guardian, correctly ordered, with the withdrawal reason intact.

**Status:** Real gap found and fixed. Ready for Review.
