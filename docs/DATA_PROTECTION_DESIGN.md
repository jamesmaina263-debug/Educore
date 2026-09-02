# Data Protection & Access Control Design (SD-04)

Status: living document. Last verified 2026-09-02 against production
(project `alzqlvfaftwegptfbfej`), by direct testing, not by reading code alone.

This exists to satisfy the GTM Readiness Protocol's SD-04 Definition of Done:
"sensitive school info is protected — encryption and access-control design are
documented." It follows the same convention as `RPO_RTO_POLICY.md` — say
plainly what's actually true, including what isn't built yet, rather than a
policy document describing an aspirational state.

## 1. Encryption in transit

All traffic to and from the app (Vercel-hosted Next.js) and the database
(Supabase-hosted Postgres) is TLS-encrypted. There is no unencrypted path —
Vercel and Supabase both enforce HTTPS/TLS unconditionally on all plans,
including the Free/Hobby tiers this project currently runs on. Nothing
school-specific was built here; it's the platform default, verified rather
than assumed.

## 2. Encryption at rest

**Database.** Supabase encrypts the underlying Postgres storage volume with
AES-256 at rest, unconditionally, on every plan including Free — this is a
platform guarantee, not something EduCore configures or could turn off.

**Secrets that need to be read back later** (things the app must retrieve in
plaintext to function — e.g. M-Pesa API credentials used to call Safaricom's
API) get an *additional* layer on top of that: application-level envelope
encryption via Supabase Vault (`vault.create_secret` / `vault.decrypted_secrets`),
so the credential is encrypted with a key EduCore's own Postgres role never
holds directly, not just relying on the disk-level guarantee alone.

**Secrets that only ever need to be verified, never retrieved** — API keys and
biometric kiosk device keys — are stored as salted one-way hashes, not
encrypted at all in the reversible sense. This is the stronger pattern
for that use case: even a full database dump can't recover the original
key, only confirm a match against a supplied one.

**What's not yet built**: the offline-first IndexedDB layer on staff/kiosk
devices (`src/lib/offline/`) stores queued writes — attendance, health,
biometric events, and others — unencrypted at the browser storage layer.
This is OS-10 in the tracker, tracked separately, genuinely absent, and free
to build (e.g. Web Crypto API) whenever it's prioritized. Flagging it here
too since it's squarely a data-protection concern: a lost or compromised
staff laptop with pending offline writes would expose that queued data.

## 3. Access control model

Every table with school-scoped data has Row Level Security enabled and a
policy built on one or both of two building blocks:

- **`auth_school_id()`** — resolves the caller's own school from their
  session; nothing scopes access by a client-supplied school ID, only the
  server-resolved one, so a request can't claim to belong to a different
  school than the caller's actual account.
- **`auth_has_permission(key)`** — checks a three-tier permission resolution:
  a per-user override, then a per-school role override, then the role's
  global default — in that priority order. Grants aren't just "does this
  role exist" but resolvable per-school and per-user, so a school can
  restrict or extend a specific staff member's access without changing the
  underlying role.

Some tables add a further ownership check beyond school-scoping alone — a
guardian's access to `students`/`invoices`/`medical_records`/etc. is scoped
to *their own children specifically* (via `student_guardians`), not merely
"any student at this school"; a teacher's write access to
`student_attendance` is scoped to classes they're the registered class
teacher for, not merely "any class at this school." **Both of these were
independently re-verified live** on 2026-09-02, not assumed from reading the
policy definitions: a real guardian session correctly saw their own child's
invoice and medical record and was correctly denied an unrelated child's;
a real teacher session's RLS write condition for attendance resolved `true`
for their own class and `false` for a class they don't teach.

Actions with side effects that can't be expressed as a simple row-level
check (financial postings, stock movements, bulk exports, permission-sensitive
lookups) go through `SECURITY DEFINER` Postgres functions rather than raw
table access from the client. Each of these re-checks the caller's permission
*inside* the function itself — never trusting that the UI already checked it
— so calling the function directly (bypassing the app entirely) is exactly
as restricted as using the feature through the UI. This was verified
directly during the SD-09 and OS-08 work: a bursar session calling
`log_school_data_export()` directly, and calling the library/inventory RPCs
with different school context, was rejected by the function itself with a
real Postgres error, not just hidden from a menu.

## 4. Audit trail

`audit_log` records `school_id`, `actor_school_user_id`, `table_name`,
`record_id`, `action`, and `created_at` for changes to a broad set of
tables (generic triggers currently cover ~30 tables spanning students,
staff, permissions, academic records, health, and discipline), plus a
smaller set of finance functions (`record_payment`, `reverse_payment`,
`allocate_unallocated_payment`, and others) and sensitive one-off actions
(the SD-09 data export) that write their own audit entries explicitly,
since their side effects don't map to a single table write a generic
trigger could hook.

Critically, **no authenticated role — including school_owner — has an
INSERT, UPDATE, or DELETE policy on `audit_log` itself.** The only way a row
gets written is through a trigger or a `SECURITY DEFINER` function, both of
which run under the definer's privileges, not the caller's. A school_owner
account, even a fully compromised one, cannot alter or erase its own audit
trail directly.

This was verified live on 2026-09-02: a real school_owner session made a
genuine change to a staff record, and the resulting `audit_log` row
correctly captured the real actor, the real timestamp, and the correct
action — not a placeholder or a generic "system" actor.

**Known gap, not yet closed**: the health module's `logEmergency` and
`createReferral` actions, and all five discipline-module write actions
(incidents, disciplinary actions, cases, welfare concerns, safeguarding
reports), are plain inserts without the generic audit trigger or a manual
audit_log write. They're still fully protected by RLS/permission checks —
this is an audit-trail completeness gap, not an access gap — but a
sensitive discipline or safeguarding record change currently doesn't
produce an audit_log entry the way a staff record or finance change does.
Worth closing in a future pass.

## 5. What this document does not cover

Legal/compliance sign-off on the privacy policy and terms pages (SD-11/12),
and formal data-processing agreements, are Legal/Compliance-owned and out of
scope for this document — it covers the technical design and its verified
behavior, not contractual or regulatory sign-off.
