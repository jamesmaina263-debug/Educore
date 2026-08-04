# EduCore — Phase 4 Handover Report

**Phase completed:** Phase 4 — AI + advanced reporting
**Date:** 2026-08-04
**Status: GREEN LIGHT ✅** (all 4 blueprint items; mobile app explicitly deferred, not a gap)

---

## 1. Objectives achieved

Phase 4's blueprint scope (§10): natural-language analytics, at-risk student identification
(rule-based first), fee collection predictive insights, advanced/management reporting, and a
mobile app "if usage justifies it." All four build items are done — schema, RLS, and UI — and
live-tested against a real fixture. The mobile app item is explicitly **not built**, not silently
dropped: there is no usage signal yet to justify it, exactly as the blueprint's own wording
anticipated.

## 2. Features implemented, by item

| # | Item | Backend | UI |
|---|---|---|---|
| 1 | Natural-language analytics ("Ask Trimora AI") | ✅ | ✅ |
| 2 | At-risk student identification (rule-based) | ✅ | ✅ (dashboard widget + reports table) |
| 3 | Fee collection predictive insights | ✅ | ✅ (reports card) |
| 4 | Advanced/management reporting | ✅ | ✅ (`/reports`) |
| — | Mobile app | Deferred by design — no usage signal yet | — |

Commits: `cdde58b` (all of Phase 4, single commit — schema was applied live via Supabase MCP
first and recovered into migration files in the same session, same discipline as Phase 3's
standing rule). Deploy `dpl_J91SaxEt5UhaxbyHp2ssJ7x1dCb8` confirmed **READY** at
`educore-beige.vercel.app`.

---

## Item 1 — Natural-language analytics ("Ask Trimora AI")

**Design choice, stated up front:** this is a classify-then-execute system, **not** text-to-SQL.
Gemini's only job is to classify a free-text question into one of six fixed, pre-defined intents
(`total_students`, `attendance_rate_today`, `fee_collection_rate`, `outstanding_balance_total`,
`at_risk_count`, `exam_average`) — it never sees the schema and never generates SQL. Actual data
retrieval runs as ordinary RLS-respecting Supabase queries under the caller's own session,
executed by plain TypeScript code, and the final answer is built from a template — never a second
LLM call — so nothing in the answer can be invented. This mirrors the report-cards AI feature's own
rule from Phase 2: AI never reaches the user un-grounded. If the question doesn't match a known
intent, the answer says so plainly and lists what it *can* answer, rather than guessing.

**Schema:** `ai_query_logs` (school_id, asked_by, question_text, matched_intent, answer_text,
created_at) — an immutable audit trail of every question asked and its answer, same "no
delete/update policy" convention as `teacher_performance_reviews`.

**Scope decision (judgment call, documented in the migration comment, same pattern as Phase 3's
Inventory roles-matrix gap):** `ai.read` is **Owner + Principal only**, not Deputy Principal. Two
reasons, both from the blueprint itself: the dashboard wireframe (Part S.3) shows the AI-flagged
at-risk widget for Owner/Principal only, and Deputy Principal is already excluded from Finance
entirely (§8) — since AI answers can surface financial figures (fee collection rate, outstanding
balances), extending `ai.read` to Deputy would quietly leak that boundary.

**UI:** `/ai` — a permission-gated page with a question box, four sample-question quick-fills, and
a running history of every question asked this school (from `ai_query_logs`). Also added as a nav
item ("Trimora AI").

**Verified:** live-tested at the SQL/RLS layer (see §7 below — `ai_query_logs` insert/select
correctly allowed for owner, correctly denied for bursar). The server action itself
(`askTrimoraAI()`) was verified by code review + a clean `tsc`/`eslint`/`next build`, not by a live
authenticated click-through in this sandbox — no browser tool and no `SUPABASE_SERVICE_ROLE_KEY` /
`GEMINI_API_KEY` were available in-session to run a full end-to-end request against the deployed
app. Flagged, not glossed over — the underlying views and RLS it depends on are live-tested; the
Gemini call itself is not.

---

## Item 2 — At-risk student identification (rule-based)

Per the blueprint's own instruction ("rule-based first"), not a trained model. `v_at_risk_students`
is a computed-on-read view (same pattern as `v_student_balances` from Phase 2 — there is still no
`pg_cron`/`pg_net` job runner in this project, a gap flagged since Phase 2's Communication item and
still true here) that flags any active student triggering one or more of three explainable rules:

1. **`low_attendance`** — present-rate over the trailing 30 days < 75%
2. **`low_academic_performance`** — most recent `class_rankings.average_score` for the *current
   active term* < 40
3. **`fee_overdue`** — a positive `v_student_balances.balance` where the underlying invoice was
   created more than 30 days ago

`risk_score` is the count of triggered rules (0–3); the view only returns rows with `risk_score >=
1`. The three thresholds (75%, 40, 30 days) are hardcoded constants for this v1, not yet
school-configurable — a real gap worth flagging for a future phase if schools want to tune them,
not silently pretended away.

`security_invoker = true` inherits RLS from `students`/`student_attendance`/`class_rankings`/
`v_student_balances` underneath; on top of that, the view adds its own
`auth_has_permission('ai.read')` filter to restrict it specifically to Owner/Principal, matching
Item 1's scope decision.

**UI:** a compact "AI-flagged at-risk" widget on the dashboard (count + top 3 names, links to
Reports) for `ai.read` holders, plus a full table on `/reports` with per-student reasons shown as
badges.

**Verified live** against a two-student fixture: one student deliberately failing all three rules
(30% attendance, exam average 30, an invoice 45 days overdue) correctly flagged with
`risk_score=3` and all three reasons; a healthy student (90% attendance, exam average 85, fully
paid) correctly excluded. Bursar session correctly returned zero rows. Fixture fully cleaned up.

---

## Item 3 — Fee collection predictive insights

Stated plainly, per Green Light honesty: this is a **linear-trend heuristic, not a trained
forecasting model**. `v_fee_collection_forecast` takes the current term's collection rate achieved
so far (total collected ÷ days elapsed since term start) and projects it forward across the days
remaining in the term. A real forecasting model needs far more historical terms of data than a
brand-new platform has — a linear projection is the honest v1, not dressed up as more
sophisticated than it is. Same `ai.read` (Owner/Principal) gate as Items 1–2, since it surfaces
finance figures.

**UI:** a "Fee collection" card on `/reports` (invoiced, collected, current rate, projected rate —
projected rate is clamped to 100% for display, since a small/early fixture can overshoot past
100% with this method, which is expected behavior of a simple linear projection, not a bug).

**Verified live:** fixture with two students (one fully paid, one unpaid), 20 days into a 60-day
term. Math checked by hand: 50% collected so far (KES 20,000 / 40,000), daily rate KES 1,000/day,
40 days remaining → projected KES 60,000 collected (150% before clamping) — arithmetic confirmed
correct for what the method actually claims to do. Bursar session correctly returned zero rows.

---

## Item 4 — Advanced/management reporting

`/reports` — a single cross-module page (Owner/Principal, via the new `reports.read` permission,
same tier as `ai.read`): enrollment trend (admissions bucketed by month, last 6 months), the fee
collection card from Item 3, a 7-day school-wide attendance-rate bar chart, and the full at-risk
table from Item 2. Also added as a nav item ("Reports").

**Mobile app — explicitly deferred, not built.** The blueprint's own wording is "if usage
justifies it" (§10, Phase 4 item 4); there is no usage signal yet from a platform with zero paying
schools live, so building one now would be speculative work ahead of any real demand. Stated
directly on the `/reports` page itself, not just in this report.

---

## 5. Database changes

Three new migrations this phase, applied live via Supabase MCP (`apply_migration`, tracked in
`supabase_migrations.schema_migrations`) and recovered into `supabase/migrations/` in the same
session — no repeat of the migration-file gap that took three phases to close before Phase 3:

- `20260804090329_ai_analytics_core_phase4_item1.sql` — `ai_query_logs` table + RLS + `ai.read`/
  `reports.read` permission seeding (Owner + Principal only)
- `20260804090347_at_risk_students_view_phase4_item2.sql` — `v_at_risk_students`
- `20260804090410_fee_collection_forecast_view_phase4_item3.sql` — `v_fee_collection_forecast`

No changes to any Phase 0–3 table or function.

## 6. Roles & permissions

Two new permission keys, both seeded **Owner + Principal only**, deliberately excluding Deputy
Principal (see Item 1's design-choice note above for the reasoning): `ai.read`, `reports.read`.
Bursar, Teacher, Class Teacher, and all module-specific roles (Librarian, Transport Manager,
Hostel Warden) get neither — Phase 4 is an Owner/Principal-tier capability across the board, same
tier as Finance's read-only-day-to-day pattern from Phase 2.

## 7. Live testing performed (Green Light — Database/Security)

All testing done against a real fixture school ("Phase 4 Test Academy") created via the Supabase
MCP, with a genuine simulated RLS session (`set role authenticated; set local
request.jwt.claims`) — not the MCP's default service-role bypass, which was confirmed to skip RLS
entirely (a tooling gotcha worth flagging for future sessions: `execute_sql` calls also each run
as their own implicit transaction, so a batch that errors mid-way rolls back everything in that
call, not just the failing statement — hit this once building the fixture and rebuilt the batch
correctly).

1. `v_at_risk_students` as Owner: correct single row, correct `risk_score=3`, correct three reasons — **PASS**
2. `v_at_risk_students` as Bursar: zero rows (no `ai.read`) — **PASS**
3. `v_fee_collection_forecast` as Owner: correct term/amounts, math verified by hand — **PASS**
4. `v_fee_collection_forecast` as Bursar: zero rows — **PASS**
5. `ai_query_logs` insert as Owner: succeeds — **PASS**
6. `ai_query_logs` insert as Bursar: RLS violation, correctly rejected — **PASS**
7. `ai_query_logs` select as Bursar: zero rows — **PASS**

Fixture fully cleaned up afterward — verified zero leftover rows across all 9 fixture tables plus
`auth.users`.

**Advisors** (`get_advisors`, security): zero new warnings from any of the 3 new relations. Every
warning present is the same pre-existing class every other RPC in this project already triggers
(`authenticated_security_definer_function_executable`, by design — every SECURITY DEFINER function
gates on an internal permission check) plus two pre-existing, unrelated items (`otp_codes` no-policy,
leaked-password-protection disabled) carried forward from before this phase.

## 8. Code quality (Green Light)

`tsc --noEmit`: clean. `eslint` (scoped to all new/changed files): clean — one real finding fixed
during the session (`react-hooks/purity`: two `Date.now()` calls in `/reports/page.tsx` flagged as
impure for a Server Component render; both replaced with a single `new Date()` captured once and
reused). `next build` (full production build, Turbopack): clean, `/ai` and `/reports` both
registered as dynamic routes alongside every existing page.

## 9. What was NOT verified this session

- **No live authenticated click-through** of `/ai` or `/reports` against the deployed app — no
  browser tool available in-sandbox, same carve-out noted since Phase 1's handover.
- **`askTrimoraAI()`'s Gemini call itself** was not exercised live — `GEMINI_API_KEY`'s status on
  Vercel is still unconfirmed (carried forward from every prior phase; no tool available to check
  Vercel environment variable values directly). If the key is genuinely unset, the action fails
  clearly with "Trimora AI isn't configured yet" rather than pretending to work — same
  fail-clearly convention as the report-cards AI drafting feature.
- The six intents in Item 1 are a fixed v1 set with no parameters (e.g. no "for Grade 5" filtering)
  — a real, deliberate scope limit stated in the code's own comments, not a bug.

## 10. Outstanding from prior phases, still not done

Carried forward unchanged from Phase 3, still genuinely unconfirmed (no tool access, not
forgotten):
- `GEMINI_API_KEY` (Vercel) status — needs a manual dashboard check (Settings → Environment
  Variables → Production).
- SMS/Email/WhatsApp provider secrets (`AT_USERNAME`/`AT_API_KEY`, `RESEND_API_KEY`/
  `RESEND_FROM_ADDRESS`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM`) — still
  expected-unset, no provider accounts created yet.

## 11. Phase 4 exit

No single cross-cutting exit criterion was defined for Phase 4 in the blueprint the way Phase 1/2
had one — read as: all 4 named items complete, live-tested at the database/RLS layer, code-quality
clean, deployed and confirmed READY, and the deliberately-deferred mobile app item stated plainly
rather than silently dropped.

**Next session should start at:** there is no fixed Phase 5 trigger in the blueprint — §10 frames
Phase 5 (multi-campus, white-label, third-party API access) as "design-on-demand, not now." The
next session should ask what's next rather than assume Phase 5 is due, and should also do the
manual Vercel dashboard check for `GEMINI_API_KEY` if AI features need to actually go live for a
real school.
