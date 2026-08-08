# EduCore — Phase 5 Handover Report

**Phase completed:** Phase 5 — Scale features (DB layer only)
**Date:** 2026-08-08
**Status: YELLOW LIGHT ⚠️** (schema + RLS + functions live-tested and clean; no application/UI
code shipped this session — flagged below, not glossed over)

---

## 1. Objectives achieved

The blueprint's own Phase 5 scope (§10) is three bullets — multi-campus, white-label,
third-party API access — explicitly marked "design-on-demand, not now." This session designed
and built the **database layer** for all three: schema, RLS, and callable functions, each
live-tested against a real fixture and cleaned up afterward, same discipline as Phase 4.

**What this session did NOT do**: touch the Next.js application. I had Supabase + Vercel MCP
access only, no checkout of the app repo, so nothing here has a UI yet. This mirrors the
project's own Medical Records precedent from the MVP definition (Part C): "schema and RLS
should exist from day one... the UI can wait a release." Same logic applied here, not chosen
lightly — flagged as the reason for Yellow, not Green.

## 2. What was already there before this session

Worth stating plainly: `schools.school_group_id`, `school_users.school_group_id`,
`schools.slug`/`logo_url`/`primary_color`, `school_groups` (bare), `auth_school_id()`,
`auth_is_super_admin()`, and the `enforce_school_user_scope` trigger already existed,
apparently pre-scaffolded for this phase but never activated (no group-tier role, no RLS
using `school_group_id`, `school_groups` had no branding columns). This session built on top
of that scaffold rather than starting from zero.

---

## Item 1 — Multi-campus

**Design decision (documented in migration comments):** a `group_admin` is READ-ONLY across
its group's campuses, via one summary function (`group_schools_summary()`), not blanket RLS
access to every operational table. Opening every table's RLS to a second scope dimension
(attendance, marks, medical_records, payments, etc.) is a large blast-radius change for a
persona need (Part B: visibility without chasing staff for numbers) that one aggregate
function already satisfies. Full cross-campus staff/student directory access is a real,
stated v1 limit for a future phase, not silently dropped.

**Design decision:** a `school_users` row is scoped to exactly one of
`{school_id, school_group_id, neither (super_admin)}`. A person who is both a specific
campus's Owner AND the group's admin needs two logins in v1 — flagged, not solved.

**Schema/functions:**
- New role: `group_admin` (13th system role)
- `enforce_school_user_scope()` extended: group_admin must have `school_id IS NULL` and
  `school_group_id IS NOT NULL`
- `auth_group_id()` — mirrors `auth_school_id()`, returns the caller's group scope only if
  they hold an active `group_admin` row
- `group_schools_summary()` — SECURITY DEFINER, self-scopes to caller's own group, returns
  per-campus enrollment count / fee collection rate / today's attendance rate
- New permissions: `group.reports.read`, `group.branding.write` (group_admin default grants)
- RLS: `schools_select_group_admin`, `school_groups_select_group_admin`,
  `school_groups_update_group_admin`

**Verified live** (fixture: 1 group, 2 campuses, 1 student with a partially-paid invoice):
1. `group_schools_summary()` as group_admin: Campus A correctly showed 1 active student,
   60.0% fee collection (KES 6,000/10,000) — **PASS**
2. `group_schools_summary()` as a school-scoped parent (non-group-admin): zero rows — **PASS**
3. `schools` visible to group_admin: 2 (both campuses) — **PASS**
4. `schools` visible to non-group-admin filtered by that group_id: 1 (RLS still isolates
   correctly — they only see their own school regardless of the group filter) — **PASS**
5. Trigger: group_admin row with a `school_id` set — correctly rejected — **PASS**
6. Trigger: group_admin row with `school_group_id IS NULL` — correctly rejected — **PASS**

Fixture fully cleaned up (schools, school_users, students, invoices, payments, auth.users).

---

## Item 2 — White-label

**Design decision:** branding resolution ("school's own value if set, else its group's, else
platform default") is an explicit fallback chain resolved in application code, not a DB-side
COALESCE — so the UI can show which value is inherited vs overridden, same "explicit over
implicit" spirit as invoice snapshotting.

**Design decision:** `whitelabel_enabled` is a platform-controlled entitlement — only
`super_admin` can flip it (presumably a paid-tier gate). A `group_admin` can edit the actual
branding values (logo/color/domain) once enabled, but cannot grant themselves the entitlement.

**Schema:**
- `school_groups` gains `logo_url`, `primary_color`, `custom_domain`, `whitelabel_enabled`
- Unique partial index on `custom_domain` (collisions across groups blocked)
- `prevent_whitelabel_self_escalation()` trigger — same shape as
  `prevent_school_user_privilege_escalation`

**Not modeled in the DB, flagged:** domain *verification* (DNS TXT/CNAME check) needs outbound
DNS lookups this session had no tool for — `custom_domain` is stored optimistically today and
should carry a `verified_at`-style flag once that flow is built.

**Verified live:**
1. group_admin updates logo_url/primary_color/custom_domain while `whitelabel_enabled=true` —
   **PASS**
2. group_admin attempts to flip `whitelabel_enabled` — correctly rejected — **PASS**
3. Second group_groups row inserted with an already-used `custom_domain` — correctly rejected
   by the unique index, whole statement rolled back (confirms the same execute_sql
   implicit-transaction behavior Phase 4 flagged) — **PASS**

Fixture fully cleaned up.

---

## Item 3 — Third-party API access

**Design decision (largest judgment call this phase):** v1 is READ-ONLY, enforced twice — a
CHECK constraint on `api_keys.scopes` (every scope must end `.read`) and, going forward, the
fixed endpoint set the not-yet-built Edge Function will recognize. A third party breaking a
school's own data via a write-capable integration is a much worse failure mode than a third
party simply not being able to write yet.

**Design decision:** this does **not** expose PostgREST/raw tables to API-key holders. An API
key is not a Postgres role and carries no JWT — there's no clean way to make PostgREST's RLS
recognize it without a much bigger auth-architecture change. Instead, matching the existing
"classify-then-execute, nothing un-grounded reaches the caller" convention from Trimora AI
(Phase 4 Item 1), an `api-v1` Edge Function will authenticate the key, resolve its scope, and
run one of a small fixed set of parameterized queries — never pass-through SQL. **That Edge
Function is not built this session** — the DB layer below is what it will call against.

**Design decision:** sensitive tables are permanently denylisted from ever being an available
scope — `medical_records`, `teacher_performance_reviews`, `payroll_records`, `documents` —
same tiering the blueprint already applies internally to Deputy Principal/Bursar.

**Schema/functions:**
- `api_keys` — scoped to exactly one of `{school_id, school_group_id}` (never both, never
  platform-wide), `key_hash` (sha256, secret shown once at creation and never stored),
  `key_prefix` for display, read-only-scopes CHECK constraint
- `api_request_logs` — immutable audit trail, no delete/update policy, same convention as
  `ai_query_logs`/`student_promotion_history` — needed to answer "who pulled this data and
  when" for a KDPA inquiry
- `issue_api_key()` — SECURITY DEFINER, generates and hashes the secret, verifies caller has
  `api.manage` and is issuing within their own school/group scope
- New permission: `api.manage`, seeded for `school_owner` and `group_admin` only (kept tighter
  than reporting permissions — this is credential issuance)

**Verified live:**
1. `issue_api_key()` as school owner with read-only scopes: succeeded, returned a real
   prefix + hashed-secret key — **PASS**
2. `issue_api_key()` with a `.write` scope: correctly rejected by the CHECK constraint —
   **PASS**
3. `issue_api_key()` for a school outside caller's own scope: correctly rejected — **PASS**
4. `api_keys` visibility from a *different* school's owner: zero rows (RLS isolation) —
   **PASS**

One real bug caught and fixed mid-session: `issue_api_key()` initially failed because
`gen_random_bytes()`/`digest()` live in the `extensions` schema, not `public`, and the
function's `search_path` didn't include it — fixed by adding `extensions` to `search_path`,
re-verified after the fix.

Fixture fully cleaned up (2 schools, 2 owners, 1 key, 2 auth.users).

---

## 5. Advisors (security) — self-caught and fixed this session

Running `get_advisors` after all three items caught two real regressions from this session's
own work, both fixed before handover:
- `auth_group_id()`, `group_schools_summary()`, `issue_api_key()` were `anon`-executable
  (default Postgres grant behavior on newly created functions) — every other `auth_*`/reporting
  RPC in this schema is authenticated-only; revoked `anon`/`public` execute, granted
  `authenticated` only, to match the existing convention.
- `array_all_read_scopes()` had a mutable search_path — fixed (low practical risk since it's
  only called from a CHECK constraint, but fixed for consistency).

Post-fix, the only remaining advisor findings are the same ones already carried forward from
Phase 3/4 (`otp_codes` no-policy, leaked-password-protection disabled) plus the
`authenticated_security_definer_function_executable` class every other RPC in this project
already triggers by design (internal permission check inside each SECURITY DEFINER function).
Zero new unresolved findings.

## 6. What was NOT verified or built this session

- **No application/UI code** — no repo access this session, only Supabase/Vercel MCP. Every
  page (`/campuses`, `/group-reports`, `/settings/branding`, `/settings/api-keys`) still needs
  to be built against the functions above.
- **`api-v1` Edge Function** — the actual authenticated gateway that resolves an API key to a
  fixed set of read-only endpoints. Not built. This is the single biggest remaining piece of
  Item 3 — the DB layer is ready for it to call.
- **Custom domain verification flow** (DNS TXT/CNAME check) — not modeled, no outbound DNS
  tool available this session.
- **Vercel routing for custom domains** — once verification exists, Vercel also needs the
  domain actually attached to the project. Not investigated this session.
- No live authenticated click-through of anything (no browser tool, same carve-out noted since
  Phase 1).

## 7. Outstanding from prior phases, still not done

Unchanged from Phase 4 — still genuinely unconfirmed, no tool access:
- `GEMINI_API_KEY` (Vercel) status — needs a manual dashboard check.
- SMS/Email/WhatsApp provider secrets — still expected-unset, no provider accounts created.

## 8. Phase 5 exit

DB layer for all three items complete, live-tested, RLS-isolated, advisor-clean. Not a full
Green Light because the application layer (Next.js pages + the api-v1 Edge Function) doesn't
exist yet — that's real, sizeable work for a session with repo access, not a rubber-stamp.

**Next session should start at:** either (a) a coding session with the Next.js repo checked
out, to build `/campuses`, `/group-reports`, `/settings/branding`, `/settings/api-keys` against
the functions shipped here, or (b) the `api-v1` Edge Function itself if third-party API access
is the priority. Ask which, don't assume.
