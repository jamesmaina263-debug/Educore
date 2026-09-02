# Educore — Consolidated Security Audit Report

Status: living document, last updated 2026-09-02.
Scope: `jamesmaina263-debug/Educore`, produced across several chat
sessions (findings below are drawn from those sessions' actual PRs and
this session's own hands-on checks — not re-invented from a checklist).
See `docs/security/THREAT-MODEL.md` for the STRIDE/trust-boundary detail
behind section D.

## A. Security posture

**Overall assessment:** reasonably mature for a solo/small-team SaaS.
Multi-tenancy is RLS-first by design (494 RLS policies across the
migration history), edge functions consistently document and enforce an
explicit auth strategy rather than relying on obscurity, secrets are
environment-variable-based with no hardcoded credentials found, dependency
audit is clean (`npm audit`: 0 vulnerabilities), and prior sessions
already closed out a systemic migration-drift problem with CI guardrails
(`migration-drift-check.yml`, `deploy-migrations.yml`).

**Major risks:** the biggest unresolved category is *unverified breadth* —
51 `SECURITY DEFINER` functions and 494 RLS policies have not all been
individually re-audited line-by-line across every session; what has been
checked (this pass's §8/§12 input-validation and frontend pass, and
earlier sessions' §5 auth/authz pass) is documented below and in prior
memory, but a full enumerate-every-policy pass has not happened in one
sitting.

**Maturity:** past "basic hygiene," approaching "systematic" — the CI
drift-check and this document are steps toward the latter; a scheduled
recurring audit (not just per-feature ad hoc review) would close the gap.

## B. Critical vulnerabilities

None found in this pass.

## C. High vulnerabilities

None found in this pass. (The `admin-create-demo-user` unauthenticated
demo-account-creation issue found and stubbed on Aug 20 2026 was High at
the time; see remaining risk in §F below — its fix needs to be committed
to source, not just deployed.)

## D. Medium / Low issues

| # | Finding | Location | Severity | Status |
|---|---|---|---|---|
| 1 | Public status-upload Server Action trusted a client-supplied `category` argument, unsanitized, into a Supabase Storage path — potential to write outside the intended `school_id/application_id/` prefix | `src/app/apply/[slug]/status/[token]/actions.ts` | Medium | **Fixed**, PR #192 |
| 2 | `admin-create-demo-user` edge function's Aug 20 2026 fix (verify_jwt on, hardcoded password removed) was applied to the deployed function but never committed to the repo | `supabase/functions/admin-create-demo-user` | Medium (process gap) | Open — needs source committed |
| 3 | `/contact` demo-request bot mitigation (honeypot + fill-time) is client-supplied and bypassable by a deliberate attacker; no server-side rate limiting | `src/app/(marketing)/contact/actions.ts` | Low (isolated, insert-only, non-tenant table) | Open — flagged since Phase 10, needs infra decision |
| 4 | No app-level rate limiting on login attempts beyond Supabase Auth's own throttling | `src/app/login/actions.ts` | Low | Open, not yet assessed against Supabase's defaults |
| 5 | M-Pesa Daraja callback (`mpesa-stk-callback`) runs with `verify_jwt` disabled; confirm a shared secret / IP allowlist exists on Daraja's side, since the URL itself is the only current barrier | `supabase/functions/mpesa-stk-callback` | Low–Medium (payment integrity) | Open — needs confirmation against live Daraja config, not re-verified this pass |
| 6 | CSP is still Report-Only, not enforcing (flagged since Aug 29 2026 Phase 9/10) | `next.config.ts` | Informational | Open, intentional pending a clean Report-Only run |

## E. Fixes implemented (this session)

- **PR #192** — validated `category` against the school's real
  `application_document_requirements` before using it in a storage path,
  closing the path-traversal risk in finding #1. `tsc`/`eslint` clean,
  `vitest` 106/106, `npm audit` 0 vulnerabilities, no behavior change for
  legitimate uploads.
- Ran and confirmed clean: `npm audit` (dependency supply-chain, §13),
  a `dangerouslySetInnerHTML`/`eval`/`.innerHTML` sweep (§12), a
  `localStorage`/`sessionStorage` content sweep (§12), and a spot-check of
  login redirect logic for open-redirect risk (§5/§12 overlap).
- Authored this report and `THREAT-MODEL.md` (§3, §14, §20).

## F. Remaining risks (cannot be fully resolved from the codebase alone)

- **Daraja/M-Pesa callback authenticity** (D#5) requires checking Safaricom's
  Daraja portal configuration, not just the repo.
- **Rate limiting infrastructure** (D#3, D#4) requires an operational
  decision (e.g. provisioning Upstash or Vercel Edge Config) that a
  code-only pass can't make unilaterally.
- **Full RLS/SECURITY DEFINER re-audit**: confirming all 494 policies and
  51 `SECURITY DEFINER` functions are individually correct is a large,
  dedicated effort beyond what any single session (including this one)
  has done in full; treat this as an ongoing, not closed, item.
- **`admin-create-demo-user` source drift** (D#2) needs someone with
  deploy access to confirm the live function's current source and commit
  it, since this pass could only read what's in the repo.

## G. Production security checklist

- [x] Authentication — Supabase Auth, deactivation re-checked server-side
- [x] Authorization — server-side role/school checks, RLS-first design
- [~] RLS — extensive coverage (494 policies); not 100% individually
      re-verified in one sitting
- [x] Tenant isolation — `school_id`-scoped throughout reviewed surfaces
- [x] Secrets — env-var based, no hardcoded credentials found
- [~] APIs / Edge Functions — all reviewed functions have explicit auth;
      Daraja callback authenticity not independently confirmed
- [~] Storage — bucket paths now validated at the app layer (PR #192);
      bucket-level RLS policies not individually re-walked this pass
- [~] Input validation — no schema-validation library (zod/yup) in use;
      validation is manual/inline per action, generally present but not
      systematic
- [x] Dependencies — `npm audit` clean, no known vulnerable packages
- [~] Logging — CSP violation reporting and Sentry exist; no uniform
      actor+action audit log across all mutating actions
- [ ] Rate limiting — not implemented beyond Supabase Auth defaults and
      cron-route bearer auth
- [x] Backups — nightly-backup.yml workflow already in place (per prior
      session notes)
- [x] Recovery / migrations — CI drift-check + auto-deploy-on-merge live
      and passing (per Aug 28 2026 verification)
- [x] Deployment configuration — Vercel + Supabase, secrets in env vars,
      CSP header present (Report-Only)
