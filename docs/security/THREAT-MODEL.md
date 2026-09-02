# Educore — Threat Model & STRIDE Analysis

Status: living document, last updated 2026-09-02. Companion to
`docs/security/AUDIT-REPORT.md` (§20 consolidated findings). Covers audit
items §3 (threat model) and §14 (STRIDE) from the security engagement.

## 1. System overview

Educore is a multi-tenant school-management SaaS (Next.js on Vercel,
Supabase Postgres/Auth/Storage/Edge Functions). Each school is a tenant;
`school_id` is the tenant boundary threaded through nearly every table.

**Roles:** platform super admin (staff, no school), school admin, finance,
teacher (class-teacher / subject-teacher), various staff roles, parent/
guardian, and unauthenticated public visitors (marketing site, admissions
applicants).

**Trust boundaries:**
1. Public internet ↔ Next.js app (Vercel edge/serverless)
2. Next.js app ↔ Supabase (Postgres via RLS, Auth, Storage, Edge Functions)
3. Supabase Edge Functions ↔ third parties (M-Pesa/Daraja, Twilio/WhatsApp,
   Resend, biometric kiosk devices)
4. Browser ↔ Next.js (cookies/session, CSP-scoped script execution)
5. School A ↔ School B (the core multi-tenant boundary — must be enforced
   at the RLS/database layer, not just in application code)

## 2. Assets

- Student PII (names, guardians, medical notes, discipline records)
- Admission applicant PII (pre-enrollment, reachable by public token)
- Financial records (fees, invoices, M-Pesa transactions, payroll)
- Biometric device-pairing keys (not raw biometric templates — see
  `src/lib/biometric/kiosk-device-key-store.ts`)
- Uploaded documents (birth certificates, report cards, ID scans)
- Auth credentials / sessions
- Service-role and third-party API secrets (Supabase, Resend, Twilio,
  M-Pesa, Sentry)

## 3. What an attacker controls vs. what the app trusts

An attacker fully controls: every HTTP request to the Next.js app
(including direct Server Action invocation with arbitrary arguments,
bypassing whatever the rendered UI restricts them to), every request to
public Edge Functions, all client-side storage/cookies, and — for
unauthenticated surfaces (marketing, `/apply/[slug]`, admission status
pages) — has zero credentials at all.

The app is designed to trust nothing from the client for authorization
decisions: RLS is the actual boundary for tenant/row access, Edge
Functions re-derive identity from the JWT or a purpose-built secret rather
than trusting client-asserted role/school claims, and cron routes require
a constant-time-compared bearer secret (`src/lib/cron-auth.ts`). The one
gap found and fixed in this pass (PR #192) was a case where a Server
Action argument (`category` on the public status-upload action) was
trusted into a storage path without validation against a server-known
allowlist — see AUDIT-REPORT.md.

## 4. STRIDE by component

### 4.1 Authentication (Supabase Auth + `src/app/login`, `signup`, `change-password`)
- **Spoofing:** mitigated by Supabase Auth password/session handling;
  deactivated accounts are explicitly re-checked and signed back out
  post-auth (`school_users.status`), since Supabase Auth itself has no
  concept of "deactivated."
- **Tampering:** login redirect destination is computed server-side from
  the authenticated user's role, never from a client-supplied `next`
  param — no open-redirect surface found.
- **Repudiation:** session establishment goes through Supabase Auth's
  standard audit trail; app-level actions are not yet uniformly logged
  with actor+timestamp outside specific domains (finance, drift-check CI).
- **Information disclosure:** login errors are generic; no user
  enumeration observed via differing error text for the paths reviewed.
- **DoS:** no explicit rate limiting on login attempts at the app layer
  (relies on Supabase Auth's own throttling) — flagged as a remaining risk.
- **Elevation of privilege:** role is read from `school_users`/RPCs
  server-side per request, not cached in a client-trusted token claim the
  app itself controls.

### 4.2 Multi-tenant data access (Postgres + RLS)
- **Tampering / Information disclosure:** primary risk is any table or
  view missing/weak RLS, or a `SECURITY DEFINER` function with an unsafe
  search_path that lets a caller act with elevated privilege across
  schools. 494 `CREATE POLICY` statements and 51 `SECURITY DEFINER`
  functions exist across the migration history — a full line-by-line
  re-audit of all 51 was out of scope for this pass (prior sessions
  audited `admin-create-demo-user` and other flagged functions; see
  AUDIT-REPORT.md for what has and hasn't been individually re-verified).
- **Elevation of privilege:** cross-school access would require either a
  missing `school_id` predicate in a policy or a function bypassing RLS
  incorrectly. No new instance found in this pass; this remains the
  single highest-value area for a dedicated follow-up pass if not already
  fully covered by earlier sessions' RLS-specific work.

### 4.3 Storage (Supabase Storage buckets)
Buckets in use: `application-documents`, `student-documents`,
`announcement-attachments`, `school-logos`, `admission-form-templates`.
- **Tampering:** the fixed vulnerability (PR #192) was exactly this —
  unsanitized path segment on a public upload action. Filenames were
  already sanitized via `safeStorageFilename()`; the fix brings `category`
  to the same standard.
- **Information disclosure:** bucket-level access should be governed by
  storage RLS policies keyed to `school_id`/`application_id`/`student_id`
  ownership, not obscurity of the generated path. Not independently
  re-verified bucket-by-bucket in this pass — recommended as a follow-up
  (list each bucket's storage policies and confirm they check ownership,
  not just "authenticated").

### 4.4 Edge Functions
All reviewed functions have an explicit, code-commented auth strategy:
- `api-v1`: Bearer API key hashed and matched against `api_keys.key_hash`.
- `biometric-verify`: `verify_jwt` disabled by design (kiosk devices carry
  no user JWT); authenticates via `biometric_devices` device-key instead.
- `mpesa-stk-callback`: `verify_jwt` disabled (Daraja can't send our
  auth headers); the callback path itself and Daraja's own request
  shape are the only signal — **worth confirming a shared-secret or
  IP-allowlist exists on the Daraja side**, since a guessed/leaked
  callback URL with no shared secret could let an attacker post fake
  payment confirmations. Not independently re-verified against Daraja's
  current config in this pass — recommend confirming.
- `mpesa-stk-push`: called from an authenticated server action; app-level
  authorization (finance.write, student-in-school, invoice ownership) is
  enforced before the function is invoked.
- `notify-platform-admin`, `send-communication`, `whatsapp-send-reply`:
  all require and check an `Authorization` header.
- `whatsapp-webhook`: verifies Twilio's request signature
  (`verifyTwilioSignature`) against `TWILIO_AUTH_TOKEN` — correct pattern
  for an inbound webhook with no user session.
- `admin-create-demo-user`: previously found with `verify_jwt: false` and
  a hardcoded password (per its own code comment); already stubbed/fixed
  in an earlier session (Aug 20 2026) — **that fix was never committed to
  the repo**, per prior audit notes. This is a real outstanding action
  item: confirm the deployed function still matches the intended fix, and
  commit its source so it's covered by future audits/CI instead of living
  only in the deployed environment.

### 4.5 Frontend (Next.js / React)
- **XSS:** no `dangerouslySetInnerHTML` usage outside `JSON.stringify()`'d
  structured data (JSON-LD); no direct DOM `.innerHTML` writes; no
  `eval`/`new Function`. Low residual risk from this vector.
- **Information disclosure via client storage:** `localStorage`/
  `sessionStorage` usage is limited to a biometric kiosk device-pairing
  key and marketing attribution (UTM/CTA source) data — no session
  tokens, PII, or secrets found in either.
- **CSRF:** Server Actions carry Next.js's built-in origin-check
  protection; no traditional form-based CSRF surface found in the
  reviewed public actions.
- **Denial of service (client-facing):** the public `/contact` demo
  request form's bot mitigation (honeypot + fill-time check) is
  client-supplied and trivially bypassable by a deliberate attacker —
  already flagged in an earlier audit pass as needing a real rate-limit
  decision (Upstash/Edge Config); still unresolved, low tenant-data risk
  since it only reaches an isolated, insert-only marketing table.

### 4.6 Cron routes (`src/app/api/cron/*`)
- **Spoofing:** mitigated by `isValidCronRequest()` — timing-safe bearer
  comparison against `CRON_SECRET`/`EXTERNAL_CRON_SECRET`. No route found
  missing this check.

## 5. Residual / accepted risks (not fixed in this pass)

These are documented, not silently dropped — see AUDIT-REPORT.md §F for
the authoritative list with severity and reasoning.
