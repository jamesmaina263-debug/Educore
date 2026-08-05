# EduCore — Gap Analysis Closure, Session 1 Handover

**Scope:** `EduCore_Gap_Analysis_and_Roadmap.md`, Tier 1 items #1 (billing), #2 (rollover), #4 (onboarding)
**Date:** 2026-08-05
**Status: 3 of 18 gap-analysis items shipped, GREEN LIGHT at the DB/RLS layer. Full list of what's not done is in §6 — please read it before assuming this closes the gap analysis.**

---

## 0. Why only 3 of 18

The gap analysis lists 18 Tier 1/2 items. Several of those (Kenya DPA legal
review, a real backup/restore drill, live authenticated browser testing) are
not code tasks an agent can complete unsupervised — they need a lawyer,
sign-off from a human, or a browser tool that isn't available in this
sandbox. Of the 15 remaining code-buildable items, this session covered the
three biggest Tier 1 blockers named in the roadmap's own suggested build
order (items 1, 2, and 4). The rest are queued in §7.

---

## 1. Academic-year rollover / bulk student promotion (Gap #2) — GREEN LIGHT

`student_promotion_history` (immutable audit table, no delete/update policy,
same convention as `teacher_performance_reviews`/`ai_query_logs`) +
`rollover_academic_year(from_year, to_year, repeat_student_ids[])`.

For every active student in the *from* year: promotes to the class one
`level_order` higher in the *to* year, matching the same-named stream first
and falling back to the first stream alphabetically if no name match exists.
Students explicitly listed in `repeat_student_ids` stay at the same level.
Students at the school's highest-ever class level are marked `graduated`
(`current_class_id` cleared). Raises a clear exception — rather than silently
mis-promoting — if the target class or stream doesn't exist yet. Closes the
*from* year and activates the *to* year (if it was `upcoming`).

Gated on the existing `students.write` permission (deputy/principal/owner) —
no new permission key needed.

**Live-tested** against a 3-student fixture (Rollover Test Academy classes):
one student correctly promoted a level, one correctly stayed at the same
level via the repeat list, one correctly graduated (highest level, no repeat
flag). Teacher session correctly denied. Fixture fully cleaned up, zero
leftovers. Caught and fixed the same anon-grant advisor warning every prior
phase has hit on new functions (`revoke ... from public` doesn't remove
Supabase's separate `anon` grant).

**UI:** Academics → Rollover tab (year pickers, repeat-student checklist,
confirm step, result summary). Gated on `students.write`.

---

## 2. Platform billing / subscription module (Gap #1) — GREEN LIGHT

`schools.status` already existed (trial/active/suspended) but nothing drove
it. Widened the check constraint to add `cancelled`, then built:

- `subscription_plans` — platform-wide catalogue (not school-scoped, same
  pattern as `payroll_statutory_rates`). Seeded 3 real plans (Starter/Growth/
  Enterprise, KES 150/200/250 per student per term) — **pricing is a
  placeholder set by me for a working default, not a blueprint or business
  figure — flag this for the business to actually decide.**
- `school_subscriptions` — one row per school, current state (trialing/
  active/past_due/suspended/cancelled).
- `platform_invoices` — what was billed and whether it was paid. All
  payments are manual today (super_admin records a reference after a bank/
  M-Pesa transfer) — same "manual bursar entry" pattern as school-level
  Finance from Phase 2. No platform payment gateway automation exists.

**New permission `billing.read`**, `school_owner` only — deliberately
narrower than Finance's owner+principal, because this is the school's
contract with the platform, not a day-to-day finance figure (documented in
the migration comment).

**Lifecycle functions** (all gated to `auth_is_super_admin()` OR
`auth.role() = 'service_role'` — no school user, however senior, can
activate/suspend/invoice their own school, mirroring how a bursar can't
self-approve an expense):
`start_trial_subscription`, `activate_subscription`, `suspend_subscription`,
`generate_platform_invoice`, `record_platform_payment`, `expire_trials`,
`mark_invoices_overdue`, `suspend_schools_with_overdue_invoices`. One
exception: `cancel_subscription` also allows the school's own owner
(self-serve close-out).

**Live-tested end to end** against Demo Academy + a disposable second school:
trial start → owner-visible/teacher-denied read → teacher-denied write →
super_admin activate → invoice generation (math correct: 0 students × KES
200 = 0, since Demo Academy currently has 0 active students) → payment
recorded → backdated invoice → `mark_invoices_overdue` correctly flips it →
`suspend_schools_with_overdue_invoices(7)` correctly suspends past the grace
period → payment recovery correctly reactivates both the subscription and
the school → **service_role path verified directly** (this is what the
signup and future cron routes rely on) → trial-expiry path verified on the
disposable school → owner self-cancel verified. All fixture data cleaned up
afterward; **Demo Academy was restored to its exact original state**
(`status='trial'`, no subscription row — it had none before this session).
Advisors: same anon-grant class caught and fixed on all 9 new functions, no
other new warnings.

**UI:** `/admin/billing` (super_admin only — activate/suspend/generate
invoice/record payment, per school, expandable rows) and Settings → Billing
tab (owner-only, read + self-cancel + invoice history).

**Not built this session, flagged not glossed over:** no Vercel Cron route
yet for `expire_trials`/`mark_invoices_overdue`/
`suspend_schools_with_overdue_invoices` — they only run if a super_admin
calls them manually right now. §7 has the plan.

---

## 3. Self-serve school onboarding (Gap #4) — GREEN LIGHT at the DB layer, UNVERIFIED end-to-end

`/signup` — public page, no auth required. Fetches active plans server-side
via the admin (service-role) client rather than opening an anon RLS policy
on `subscription_plans`. On submit: creates the owner's auth account →
creates the `schools` row (`status='trial'`) → creates the owner's
`school_users` row → calls `start_trial_subscription` via the service-role
client. Rolls back everything (auth user, school, school_users row) if any
step fails, same pattern as the existing `inviteStaffMember` action.

**Real discovery this session that simplified this item significantly:**
`role_permissions` defaults are already seeded platform-wide with
`school_id IS NULL` (confirmed: all 122 existing rows use the default,
none are school-specific). This means **every new school automatically
inherits the full 12-role permission matrix with zero seeding work** — the
architecture was already correct for self-serve onboarding, I just hadn't
verified it until this session. Worth knowing for any future school-creation
path (e.g. a future admin "create school manually" tool).

**Not verified this session:** I have no browser tool in this sandbox, so
the signup flow has never actually been clicked through end-to-end. `tsc`,
`eslint`, and `next build` are all clean on it, and the service-role RPC
path it depends on (`start_trial_subscription` called with
`auth.role() = 'service_role'`) was directly verified via SQL. But the
`adminClient.auth.admin.createUser()` call, the rollback-on-failure paths,
and the final `signInWithPassword()` hand-off have only been read-reviewed,
not exercised. **First real signup attempt should be watched closely.**

---

## 4. Verification performed this session

- `tsc --noEmit`: clean.
- `eslint` (scoped to every new/changed file): clean.
- `next build` (Turbopack, full production build): clean. All new routes
  registered as dynamic (`/signup` static, `/admin/billing` and the
  `/academics`, `/settings` changes dynamic, matching every other
  authenticated page).
- Supabase advisors (security): zero new warning *classes* introduced —
  every new function landed in the same `authenticated_security_definer_
  function_executable` class every other RPC in this project already
  triggers by design (internal permission check gates it), after fixing the
  anon-grant gotcha on each. The two pre-existing items (`otp_codes`
  no-policy, leaked-password-protection disabled) are unchanged, carried
  forward as before.
- Deploy `dpl_3CduxAPykHLoTiMDu5PNKQJiVweQ` confirmed **READY** at
  `educore-beige.vercel.app`.

**Not performed, flagged not glossed over:**
- No live authenticated browser click-through of `/signup`, `/admin/billing`,
  the new Settings Billing tab, or the Academics Rollover tab — no browser
  tool in this sandbox, same carve-out noted in every phase since Phase 1.
- No `super_admin` account exists on the platform yet, so `/admin/billing`
  has never actually been opened by a real session — only verified via
  simulated-JWT SQL testing. **Someone needs to create a real super_admin
  school_user before this page is usable in practice.**

---

## 5. Migrations recovered

7 new migrations pulled verbatim from
`supabase_migrations.schema_migrations` and committed to
`supabase/migrations/`, following the standing rule from Phase 3:

```
20260805033631_rollover_core_schema.sql
20260805033650_rollover_function.sql
20260805034002_rollover_function_revoke_anon.sql
20260805034029_billing_core_schema.sql
20260805034059_billing_lifecycle_functions.sql
20260805034156_billing_functions_revoke_anon.sql
20260805082627_billing_seed_default_plans.sql
```

Commit `7fbeea2`, pushed to `main`, deployed and confirmed READY (see §4).
GitHub PAT was provided in-chat this session, used only for the
clone/commit/push, never stored.

---

## 6. What genuinely is NOT done (read this before assuming the gap analysis is closed)

**Tier 1, not started:**
- #3 Kenya Data Protection Act 2019 compliance review — legal work, not
  code. Needs an actual lawyer.
- #5 Provider secrets confirmed live — still needs a manual Vercel/Supabase
  dashboard check (`GEMINI_API_KEY`, `AT_USERNAME`/`AT_API_KEY`,
  `RESEND_API_KEY`/`RESEND_FROM_ADDRESS`, `TWILIO_*`), unchanged since Phase
  1.
- #6 Live authenticated browser verification — no browser tool available.

**Tier 2, not started:** CBC curriculum modeling (#7), fee waivers/
scholarships as first-class records (#8), communication_templates/
notification_logs completeness check (#9), Timetable UI (#10), staff
attendance (#11), public admissions form (#12), notification preferences
(#13), automated test suite + CI (#14), Sentry/observability (#15), secrets
rotation policy (#16), RPO/RTO + backup drill (#17), OTP brute-force
protection check (#18).

**New operational gap this session surfaced, not in the original analysis:**
no `super_admin` account exists anywhere on the platform. The billing admin
tooling built this session (`/admin/billing`) is real and tested at the DB
layer, but nobody can actually use it in production yet until a real
super_admin `school_users` row (with `school_id = null`) is created for a
real person.

---

## 7. Recommended next session

In the roadmap's own suggested order, the next pass should pick up:
Tier 2 items 7–8 (CBC modeling, fee waivers — data-model correctness,
cheapest before live data accumulates), then 14–18 (tests/CI/monitoring/DR/
secrets — infrastructure hygiene), then 9–13 (comms completeness, timetable
UI, staff attendance, admissions form, notification prefs — the
long-deferred MVP loop items). Tier 3 (ID cards, certificates, homework,
discipline records, PTM scheduling) stays demand-driven, same as this
session's approach to everything else.

Concretely worth doing early next session, before any further feature work:
1. A Vercel Cron route (`/api/cron/billing`, protected by a `CRON_SECRET`
   header) calling `expire_trials`/`mark_invoices_overdue`/
   `suspend_schools_with_overdue_invoices` daily — the functions exist and
   are tested, they just aren't wired to run automatically yet.
2. Create a real `super_admin` school_user for whoever will operate
   `/admin/billing`.
3. A first live signup attempt through `/signup`, watched closely, since
   that whole path is unverified beyond `tsc`/`eslint`/`next build`.
