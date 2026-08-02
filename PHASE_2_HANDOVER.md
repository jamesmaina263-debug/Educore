# EduCore — Phase 2 Handover Report

**Phase completed:** Phase 2 — Exams, Report Cards, Finance, Teacher Performance, Portals, Communication
**Date:** 2026-08-01
**Status: GREEN LIGHT ✅** (all 6 build items + exit criterion)

---

## 1. Objectives achieved

Phase 2's blueprint objective (Part O, §10) was: Exams (CATs/Exams, Marks Entry, configurable Grading, Rankings), Report Cards (generation + AI-drafted, teacher-approved comments), Finance (Fee Structures, Invoices, M-Pesa Payments, Balances, Discounts, Expenses), Teacher Performance reviews, Portals (Parent/Student/Teacher), Communication (SMS live), exiting on: *"a school can run one full term end-to-end — admit, teach, examine, bill, collect payment, publish report cards."*

All 6 build items are done — schema, RLS, and UI — and the exit criterion has been demonstrated with a real, continuous, cross-role data story spanning Admissions through Communication (see §9).

A note on this phase's starting point: the file the previous session named `educore-blueprint.md` turned out, on inspection, to be the Phase 1 Handover Report, not the actual master blueprint. The real blueprint was re-uploaded and read directly from disk at the start of this phase — flagged here so a future session double-checks file contents rather than trusting a filename.

## 2. Features implemented, by item

| # | Item | Backend | UI |
|---|---|---|---|
| 1 | Exams (Grading Scales, CATs/Exams, Marks Entry, Rankings) | ✅ | ✅ |
| 2 | Report Cards (generation, AI-drafted + teacher-approved comments) | ✅ | ✅ |
| 3 | Finance (Fee Structures, Invoices, Payments, Balances, Discounts, Expenses) | ✅ | ✅ |
| 4 | Teacher Performance reviews | ✅ | ✅ |
| 5 | Portals (Parent/Student single-page; Teacher = existing staff dashboard) | ✅ | ✅ |
| 6 | Communication (SMS: templates, compose, automatic absence alerts) | ✅ | ✅ |

Both grading models (Numeric/Percentage and CBC Competency-Based) are supported from the start, selectable at school or class/grade level, per explicit user instruction — not deferred as originally flagged as an open question in the Phase 1 handover.

Live M-Pesa Daraja STK-push automation, `fee_waivers`/`scholarships` as a distinct recurring-policy entity, group-level (`school_group_id`) fee-structure sharing across campuses, a guardian-acknowledgment mechanism for absences, and `pg_cron`/`pg_net` background dispatch for queued communications are **deferred**, per the blueprint's own scope notes and real infrastructure/credential constraints — not silently dropped, each was flagged at the point it came up (see §8, §13).

## 3. Files created, modified, or removed

**Created:**
- `src/app/exams/{page.tsx,actions.ts}`, `src/app/exams/marks/page.tsx`, `src/app/exams/report-cards/{page.tsx,actions.ts}`, `src/components/exams/{grading-scales-section,exams-section,marks-picker,marks-entry-form,report-card-list,report-card-picker}.tsx`
- `src/app/finance/{page.tsx,actions.ts}`, `src/components/finance/{fee-structures-section,balances-section,invoices-section,payments-section,discounts-section,expenses-section}.tsx`
- `src/app/performance/{page.tsx,actions.ts}`, `src/components/performance/performance-section.tsx`
- `src/app/portal/{page.tsx,actions.ts}`, `src/components/portal/child-switcher.tsx`
- `src/app/communication/{page.tsx,actions.ts}`, `src/components/communication/{compose-section,templates-section,history-section}.tsx`
- `supabase/functions/send-communication/index.ts` (new Edge Function, deployed and ACTIVE)
- `PHASE_2_HANDOVER.md` (this file)

**Modified:**
- `src/app/dashboard/page.tsx`, `src/components/dashboard/module-widgets.tsx` — added Exams and Finance widgets
- `src/components/app-shell/nav-items.tsx` — added Exams, Finance, Performance, Communication nav entries; repointed the pre-existing "Fees" placeholder (pointed at a route that never existed) to the real `/finance`
- `src/app/parent-login/page.tsx` — fixed the post-OTP redirect, which pointed at the staff `/dashboard` (a real pre-existing bug); now goes to `/portal`
- `.env.local.example` — documented `GEMINI_API_KEY`

**No files removed.**

## 4. Database schema changes / migrations created

All applied via Supabase MCP directly against project `alzqlvfaftwegptfbfej` (same pre-existing technical debt as Phase 1: no local migration files mirrored into the repo — still flagged, still not resolved, see §11).

- `grading_scales`, `grading_scale_bands`, `exams`, `exam_classes`, `exam_subjects`, `marks`, `class_rankings` (Item 1)
- `report_cards` (Item 2)
- `fee_structures`, `fee_items`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `discounts`, `expenses`, `schools.expense_approval_threshold`, view `v_student_balances` (Item 3)
- `teacher_performance_reviews` (Item 4)
- No new tables for Item 5 (Portals) — an RLS-only pass across existing Item 1–2 tables plus `student_attendance`/`timetable_slots` from Phase 1
- `communication_templates`, `notification_logs` (Item 6)

## 5. RLS policies added or modified

Every new table has RLS enabled, tenant-scoped and permission-gated, following the established `auth_school_id()`/`auth_has_permission(key)` pattern. Notable non-obvious ones:

- `marks`/`report_cards`: two-tier write population (`marks.write` scoped to the teacher's own `class_subjects` assignment vs `marks.write_any` for deputy/principal/owner; `report_cards.approve` scoped to the class teacher's own stream vs `report_cards.approve_any`)
- `report_cards`/`marks`/`class_rankings` guardian/self read is gated on `comment_source in ('teacher_approved','teacher_written')` — a report card with no comment yet is *also* withheld from a parent, not just an unapproved AI draft (see §11)
- `finance.write` deliberately excludes Principal (read-only day-to-day) and Deputy Principal (none at all) — matches the blueprint's roles matrix exactly; `discounts.approve`/`expenses.approve` are separate permissions from `finance.write` so a bursar cannot self-approve their own discount or above-threshold expense (verified live)
- `teacher_performance_reviews` has no delete policy — a review is a historical record, same precedent as Phase 1's `audit_log`
- `v_student_balances` is a `security_invoker=true` view — without that flag it would silently bypass the RLS of every table underneath it
- Two Supabase-specific gotchas hit repeatedly this phase, now routine to check on every new function/policy: `revoke ... from public` does not remove Supabase's separate auto-granted explicit `anon` privilege on a new function (needs its own `revoke ... from anon`); multiple narrow SELECT policies (staff/guardian/self) should be consolidated into one OR'd policy per table to avoid the advisor's `multiple_permissive_policies` warning

## 6. API endpoints / server actions implemented

All as Next.js Server Actions plus Postgres RPCs (SECURITY DEFINER functions), same pattern as Phase 1: `exams/actions.ts` (create/close/reopen exam, submit/edit marks, grading scale + class-override config), `exams/report-cards/actions.ts` (generate, approve/write/draft-with-AI comment), `finance/actions.ts` (fee structure + items, generate invoices, record payment, request/approve/reject discount, raise/approve/reject expense), `performance/actions.ts` (create review), `communication/actions.ts` (create template, compose+queue+dispatch, manual dispatch trigger). One new Edge Function, `send-communication`, added alongside Phase 0's `request-otp`/`verify-otp` — reuses the same `AfricasTalkingProvider`/`ConsoleSmsProvider` factory, no new SMS integration built.

## 7. UI pages and reusable components completed

`/exams`, `/exams/marks`, `/exams/report-cards` (new this phase); `/finance` (6 tabs); `/performance`; `/portal` (new — Parent/Student single-page, not a widget grid); `/communication` (3 tabs). `/dashboard` gained Exams and Finance widgets. No new page for "Teacher Portal" — concluded the existing staff `/dashboard` already serves that role (see §11).

**Two regressions found and fixed this phase**, both caught by live testing before shipping, not after:
1. The first version of `report_cards_update_own_class` (Item 2) scoped by `report_cards.class_id` (the grade) instead of the student's actual stream, so a class teacher of one stream could edit report cards for a *different* stream in the same grade — fixed to join through `students.current_class_id → streams.class_teacher_id`.
2. `parent-login`'s post-OTP redirect pointed at the staff `/dashboard` (pre-existing, from Phase 0) — a parent/student landing there would see mostly-empty widgets built for staff roles. Fixed to redirect to the new `/portal`.

## 8. Business logic implemented

- **Grading resolution**: a class's grading scale resolves to its own override, else the school's default (`grading_scales.is_default`); numeric scores auto-resolve to a band by range, CBC entries require a direct band selection, enforced by a single trigger regardless of which model is in play
- **Exam/marks locking**: exam structure (classes/subjects) locks on close; marks lock on close except with a required edit reason — same audit-trail shape as Phase 1's attendance edits
- **Report card publish gate**: a report card (and the marks/ranking data behind it) is invisible to a parent/student until `comment_source` is `teacher_approved` or `teacher_written` — the mechanism that actually enforces "no AI text reaches a parent unreviewed, ever," since Supabase exposes every table via REST regardless of what the UI shows
- **Invoice snapshotting**: `generate_invoices()` snapshots the active fee structure at generation time; a later fee-structure change never retroactively changes what a family already agreed to pay
- **FIFO payment allocation**: `record_payment()` allocates across a student's oldest outstanding invoices first, or takes an explicit bursar allocation; `invoices.status` is trigger-maintained from allocations + approved discounts
- **Approval separation**: `discounts.approve`/`expenses.approve` are held only by Principal/Owner, never by the Bursar who requests them — verified live in both cases
- **3-consecutive-absence alert**: fires exactly once per streak (the day it crosses to 3, never re-fires on day 4+), simplified from the blueprint's exact wording (see §11)

## 9. Testing performed / exit-criterion verification

Every item was live-tested against the real Supabase project with real fixture data, then cleaned up (explicit deletes, verified zero leftovers every time). Totals: 13 (Item 1) + 8 (Item 2) + 16 (Item 3) + 7 (Item 4) + 9 (Item 5) + 5 (Item 6) = **58 real assertions passed** across the phase, plus `tsc`/`eslint`/`next build` clean on every commit, plus every Vercel production deploy confirmed `READY` via the API (with one mid-phase gap where the Vercel MCP connector was briefly unavailable — both affected deploys were retroactively confirmed once it came back).

**Exit criterion**, run as one continuous cross-role story: a fictional school ("Exit Criterion Academy") admits a student through the full state machine, a class teacher marks a week of daily attendance, a deputy principal creates and closes an end-of-term exam, a subject teacher enters marks for their own assignment, rankings compute automatically, report cards generate and the class teacher publishes a comment, a bursar generates the term's invoice and records a full M-Pesa payment, the parent portal correctly shows the resulting zero balance, 80% attendance, and the published report card together, and a fee-related SMS is composed, rendered, and queued. **All 7 steps passed.**

**What remains unverified from this sandbox, stated plainly**: real browser click-through (same as Phase 1 — no browser tool exists here); live SMS delivery through Africa's Talking (`AT_USERNAME`/`AT_API_KEY` Supabase secrets unconfirmed — falls back to console-logging if unset, never fakes a send); the actual dispatch leg of the exit-criterion SMS (queueing and rendering were verified live; calling the deployed Edge Function requires a real user session token this sandbox can't obtain, so that specific hop rests on Item 6's own unit-level Edge Function testing, not a live end-to-end call); live Gemini AI comment drafting (`GEMINI_API_KEY` not yet set in Vercel — no tool available to set it).

## 10. GREEN LIGHT validation results

Items 1–6: each individually GREEN LIGHT'd with live-tested evidence (see project memory for full per-item detail, and commits `8113f70`, `1a8898b`/`23007c4`, `b696ac0`, `3318f55`, `1839e69`, `416fe8b`). Exit criterion: GREEN LIGHT ✅ (§9). **Phase 2 overall: GREEN LIGHT ✅**, with the unverified-from-sandbox caveats above explicitly carried forward, not hidden.

## 11. Architectural decisions and reasoning

- **Both grading models from day one**: `grading_scales`/`grading_scale_bands` use one unified band shape for numeric (min/max/points) and CBC (label+order only) rather than two separate schemas — a class resolves to its own override or the school default, so CBC classes need no future breaking migration when their UI gets more attention
- **Report card publish gate over column masking**: rather than building a masking view or relying on the UI to hide an unapproved AI comment, the RLS policy itself withholds the whole `report_cards` row (and its `marks`/`class_rankings`) until `comment_source` is a published state — enforced at the only layer that actually matters, since Supabase's auto-generated REST API bypasses any UI-only protection
- **Balances computed-on-read, invoice status trigger-maintained**: a school-wide balance aggregate stays a live view (`v_student_balances`) rather than a cached column, avoiding a whole class of stale-balance bugs; only the cheap, single-row `invoices.status` is trigger-maintained, matching the blueprint's own indexing guidance
- **Absence-alert simplified, not invented**: the blueprint's "without a guardian-acknowledged reason" implies an acknowledgment mechanism (a table, a portal flow to submit one) that doesn't exist anywhere in the schema; rather than inventing that silently inside a trigger, the alert fires on the plain 3-day streak and the gap is flagged for a future session to decide on deliberately
- **No pg_cron/pg_net yet**: system-queued communications (the absence alert) dispatch the next time a staff member with `communication.write` visits `/communication`, not on a background schedule — a real, flagged simplification; the detection/queueing business rule itself is fully correct regardless of when dispatch happens
- **Teacher Portal = existing dashboard**: rather than building a redundant new page, Item 5 concluded the existing staff AppShell dashboard (with its Attendance and Exams widgets) already covers most of the blueprint's specified Teacher/Class Teacher widgets; the one gap (today's timetable) is blocked on `timetable_slots` having no data anywhere yet, since the Timetable UI itself was deferred back in Phase 1

## 12. Technical debt

- Same as Phase 1: no local migration files — all schema changes applied directly via Supabase MCP, still not mirrored into `supabase/migrations/*.sql` in the repo
- `GEMINI_API_KEY` not set in Vercel; `AT_USERNAME`/`AT_API_KEY` not confirmed set as Supabase Edge Function secrets — both degrade gracefully (clear error / console-log) rather than failing silently, but neither has been live-verified
- No `pg_cron`/`pg_net` background dispatch for queued communications (see §11)
- No guardian-acknowledgment mechanism for absences (see §11 and §8)

## 13. Deferred work (confirmed with user, not silent)

Live M-Pesa Daraja STK-push automation (needs the school's own real Paybill/Till credentials — every payment today is manual bursar entry after an SMS confirmation); `fee_waivers`/`scholarships` as a distinct recurring-policy entity separate from ad-hoc `discounts` (the blueprint's own flagged gap, not mandated this phase); group-level (`school_group_id`) fee-structure sharing across campuses (schema allows it later, matches the existing "multi-campus designed now, built Phase 5" decision); Timetable UI (schema only, still from Phase 1) — each flagged at the point it came up rather than assumed.

## 14. Known issues

- Carried forward from Phase 1, still unresolved: `otp_codes` RLS-enabled-no-policy linter INFO (presumed intentional); `storage.objects` DELETE policy for `student-documents` untested from this sandbox; `SUPABASE_SERVICE_ROLE_KEY` in Vercel unconfirmed
- New this phase: `GEMINI_API_KEY` and `AT_USERNAME`/`AT_API_KEY` unconfirmed (see §12)
- The exit-criterion SMS's actual Edge Function dispatch hop was not live-called end-to-end (see §9) — the queueing/rendering business logic was verified live; the HTTP call to `send-communication` itself rests on that function's own testing during Item 6, not a fresh live call in this exit-criterion run

## 15. Remaining work / exact Phase 3 starting point

Per the blueprint's phase list, **Phase 3 is next** (not read in detail this session — this phase's focus was closing out Phase 2). The next chat should open by reading this file, the master blueprint (`educore-blueprint.md` — verify it's actually the blueprint and not a mis-named handover report, per the note in §1), and the project memory before writing any code, then confirm Phase 3's exact scope/MVP split against the blueprint rather than assuming it.

## 16. Recommendations for the next session

1. Resolve the four unconfirmed-secret items early: `GEMINI_API_KEY` (Vercel), `AT_USERNAME`/`AT_API_KEY` (Supabase Edge Function secrets), `SUPABASE_SERVICE_ROLE_KEY` (Vercel, carried from Phase 1) — confirm all four are actually set, then do one real live-fire test of AI comment drafting and SMS dispatch now that credentials should exist.
2. Pull real migration files into the repo — this has been flagged since Phase 1 and is now two phases' worth of schema behind.
3. If Phase 3 (or a future phase) touches attendance/communication further, revisit the guardian-acknowledgment gap flagged in §11 — it's a natural, small addition once there's a concrete need driving it, rather than building it speculatively now.
4. If a future session is Supabase-only (no GitHub access), it should ask for a GitHub PAT before making any change that could affect already-deployed UI code paths, per the same caution the Phase 1 handover already recommended.
