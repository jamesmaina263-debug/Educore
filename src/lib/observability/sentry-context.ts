import * as Sentry from "@sentry/nextjs";

// 2026-09-14 production-readiness audit finding: Sentry is installed and correctly configured
// with sendDefaultPii: false (see src/sentry.server.config.ts), but nothing in the app actually
// attaches school_id/user_id to a captured error -- so when something does go wrong in a Server
// Action, Sentry gives a stack trace and an environment tag, not "which school, which user". The
// audit's own words for what's needed: "which school -> which user -> which request -> which
// endpoint -> what failed -> when -> why". This closes the school/user half of that gap.
//
// Deliberately NOT sendDefaultPii-adjacent: only opaque IDs (school_id, user_id) go to Sentry,
// never names/emails/phone numbers -- same posture the rest of the codebase already holds to.
// Deliberately fire-and-forget: Sentry.setUser/setTag are synchronous, in-memory, per-request
// calls (no network round trip, can't throw in a way that should ever block or fail an action) --
// consistent with sendSecurityAlert()'s "an alerting outage is not a reason to degrade the actual
// feature" principle elsewhere in this codebase, just via a mechanism that literally cannot fail
// rather than one that's wrapped in try/catch.
//
// Call this once per Server Action, as soon as school_id (and optionally the authenticated
// user's id) are known -- e.g. from the schoolId(supabase) helper duplicated across
// finance/actions.ts, academics/actions.ts, exams/actions.ts, boarding/actions.ts, and
// communication/actions.ts. Not wired into every action in the app in this pass -- deliberately
// scoped to the highest-value, most sensitive surfaces (finance, academics/exams, boarding,
// communication) rather than a repo-wide sweep; extending it to more files is the same
// three-line pattern.
export function setSentryRequestContext(params: { schoolId?: string | null; userId?: string | null }) {
  if (params.userId) {
    Sentry.setUser({ id: params.userId });
  }
  if (params.schoolId) {
    Sentry.setTag("school_id", params.schoolId);
  }
}
